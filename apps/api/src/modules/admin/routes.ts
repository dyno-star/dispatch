// Admin review of rider applications. Every route requires the admin role.

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { RIDER_STATUSES } from "@dispatch/shared";
import type { RiderDocumentKind, RiderStatus, VehicleType } from "@dispatch/shared";
import type { AppDeps } from "../../deps.js";
import { withTransaction } from "../../db/pool.js";
import { badRequest, conflict, notFound } from "../../http/errors.js";
import { currentUser, makeGuard } from "../../http/auth-guard.js";
import { listDocuments, missingDocuments } from "../riders/routes.js";

const listQuery = z.object({ status: z.enum(RIDER_STATUSES).default("pending") });
const idParams = z.object({ id: z.uuid() });
const verifyBody = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(1).max(500).optional(),
});

interface RiderSummary {
  id: string;
  name: string;
  phone: string;
  status: RiderStatus;
  vehicleType: VehicleType;
  plate: string | null;
  createdAt: Date;
}

const RIDER_COLUMNS = `u.id, u.name, u.phone, rp.status, rp.vehicle_type AS "vehicleType", rp.plate,
  rp.created_at AS "createdAt"`;

export function adminRoutes(deps: AppDeps): FastifyPluginAsync {
  const guard = makeGuard(deps);

  return async (app) => {
    app.addHook("preHandler", guard("admin"));

    app.get("/riders", async (req) => {
      const { status } = listQuery.parse(req.query);
      // ::text so pg returns a string[] rather than an unparsed enum array literal.
      const { rows } = await deps.db.query<RiderSummary & { documentKinds: RiderDocumentKind[] }>(
        `SELECT ${RIDER_COLUMNS},
                COALESCE(
                  (SELECT array_agg(DISTINCT d.kind::text ORDER BY d.kind::text)
                   FROM rider_documents d WHERE d.rider_id = rp.user_id),
                  '{}'
                ) AS "documentKinds"
         FROM rider_profiles rp
         JOIN users u ON u.id = rp.user_id
         WHERE rp.status = $1
         ORDER BY rp.created_at`,
        [status],
      );
      return { riders: rows };
    });

    app.get("/riders/:id", async (req) => {
      const { id } = idParams.parse(req.params);
      const { rows } = await deps.db.query<RiderSummary>(
        `SELECT ${RIDER_COLUMNS}, rp.rejection_reason AS "rejectionReason", rp.approved_at AS "approvedAt",
                rp.reviewed_by AS "reviewedBy", rp.reviewed_at AS "reviewedAt"
         FROM rider_profiles rp
         JOIN users u ON u.id = rp.user_id
         WHERE rp.user_id = $1`,
        [id],
      );
      const rider = rows[0];
      if (!rider) throw notFound("rider_not_found", "Rider not found");
      const documents = await listDocuments(deps.db, id);
      return { ...rider, documents, missingDocuments: missingDocuments(documents) };
    });

    app.get("/documents/:id", async (req, reply) => {
      const { id } = idParams.parse(req.params);
      const { rows } = await deps.db.query<{ file_key: string; content_type: string | null }>(
        "SELECT file_key, content_type FROM rider_documents WHERE id = $1",
        [id],
      );
      const doc = rows[0];
      const data = doc && (await deps.storage.get(doc.file_key));
      if (!doc || !data) throw notFound("document_not_found", "Document not found");

      return reply
        .header("content-type", doc.content_type ?? "application/octet-stream")
        .header("cache-control", "private, no-store")
        .header("x-content-type-options", "nosniff")
        .send(data);
    });

    app.post("/riders/:id/verify", async (req) => {
      const admin = currentUser(req);
      const { id } = idParams.parse(req.params);
      const body = verifyBody.parse(req.body);
      if (body.decision === "reject" && !body.reason) {
        throw badRequest("reason_required", "Give a reason so the rider knows what to fix");
      }

      const result = await withTransaction(deps.db, async (client) => {
        const { rows } = await client.query<{ status: RiderStatus }>(
          "SELECT status FROM rider_profiles WHERE user_id = $1 FOR UPDATE",
          [id],
        );
        const profile = rows[0];
        if (!profile) throw notFound("rider_not_found", "Rider not found");
        if (profile.status !== "pending") {
          throw conflict("rider_not_pending", `This application is already ${profile.status}`);
        }

        if (body.decision === "approve") {
          const missing = missingDocuments(await listDocuments(client, id));
          if (missing.length > 0) {
            throw conflict("documents_missing", `Missing documents: ${missing.join(", ")}`);
          }
          await client.query(
            `UPDATE rider_profiles
             SET status = 'approved', approved_at = now(), rejection_reason = NULL,
                 reviewed_by = $2, reviewed_at = now()
             WHERE user_id = $1`,
            [id, admin.id],
          );
          await client.query(
            `UPDATE rider_documents SET verified_by = $2, verified_at = now()
             WHERE rider_id = $1 AND verified_at IS NULL`,
            [id, admin.id],
          );
          return { id, status: "approved" as const };
        }

        await client.query(
          `UPDATE rider_profiles
           SET status = 'rejected', rejection_reason = $3, reviewed_by = $2, reviewed_at = now()
           WHERE user_id = $1`,
          [id, admin.id, body.reason],
        );
        return { id, status: "rejected" as const, rejectionReason: body.reason };
      });

      req.log.info({ adminId: admin.id, riderId: id, decision: body.decision }, "Rider application reviewed");
      return result;
    });
  };
}
