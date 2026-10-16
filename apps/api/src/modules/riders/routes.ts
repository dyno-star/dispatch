// Rider onboarding: apply, upload documents, check application status.
// See docs/system-design/10-trust.md and docs/api/step-1-auth-and-riders.md.

import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { REQUIRED_RIDER_DOCUMENTS, RIDER_DOCUMENT_KINDS, VEHICLE_TYPES } from "@dispatch/shared";
import type { RiderDocumentKind, RiderStatus, VehicleType } from "@dispatch/shared";
import type { AppDeps } from "../../deps.js";
import type { DbClient } from "../../db/pool.js";
import { withTransaction } from "../../db/pool.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../http/errors.js";
import { currentUser, makeGuard } from "../../http/auth-guard.js";
import { detectFileType } from "./file-type.js";

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const applyBody = z.object({
  vehicleType: z.enum(VEHICLE_TYPES),
  plate: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .transform((p) => p.toUpperCase().replace(/\s+/g, " ")),
});
const documentParams = z.object({ kind: z.enum(RIDER_DOCUMENT_KINDS) });

interface ProfileRow {
  status: RiderStatus;
  vehicleType: VehicleType;
  plate: string | null;
  rejectionReason: string | null;
  approvedAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface DocumentRow {
  id: string;
  kind: RiderDocumentKind;
  contentType: string | null;
  sizeBytes: number | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

const PROFILE_COLUMNS = `status, vehicle_type AS "vehicleType", plate, rejection_reason AS "rejectionReason",
  approved_at AS "approvedAt", reviewed_at AS "reviewedAt", created_at AS "createdAt"`;

export const DOCUMENT_COLUMNS = `id, kind, content_type AS "contentType", size_bytes AS "sizeBytes",
  verified_at AS "verifiedAt", created_at AS "createdAt"`;

export function missingDocuments(documents: { kind: RiderDocumentKind }[]): RiderDocumentKind[] {
  const have = new Set(documents.map((d) => d.kind));
  return REQUIRED_RIDER_DOCUMENTS.filter((kind) => !have.has(kind));
}

export async function listDocuments(db: Pick<DbClient, "query">, riderId: string): Promise<DocumentRow[]> {
  const { rows } = await db.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM rider_documents WHERE rider_id = $1 ORDER BY created_at`,
    [riderId],
  );
  return rows;
}

export function riderRoutes(deps: AppDeps): FastifyPluginAsync {
  const guard = makeGuard(deps);

  return async (app) => {
    app.post("/apply", { preHandler: guard() }, async (req, reply) => {
      const user = currentUser(req);
      if (user.role === "admin") throw forbidden("forbidden", "Admins can't apply to be riders");
      const body = applyBody.parse(req.body);

      const profile = await withTransaction(deps.db, async (client) => {
        const existing = await client.query<{ status: RiderStatus }>(
          "SELECT status FROM rider_profiles WHERE user_id = $1 FOR UPDATE",
          [user.id],
        );
        const status = existing.rows[0]?.status;
        if (status && status !== "rejected") {
          throw conflict("already_applied", "You have already applied to be a rider");
        }
        const { rows } = await client.query<ProfileRow>(
          `INSERT INTO rider_profiles (user_id, status, vehicle_type, plate)
           VALUES ($1, 'pending', $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET
             status = 'pending', vehicle_type = EXCLUDED.vehicle_type, plate = EXCLUDED.plate,
             rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, approved_at = NULL
           RETURNING ${PROFILE_COLUMNS}`,
          [user.id, body.vehicleType, body.plate],
        );
        await client.query("UPDATE users SET role = 'rider' WHERE id = $1", [user.id]);
        return rows[0]!;
      });

      return reply.code(201).send(profile);
    });

    app.get("/me", { preHandler: guard("rider") }, async (req) => {
      const user = currentUser(req);
      const { rows } = await deps.db.query<ProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM rider_profiles WHERE user_id = $1`,
        [user.id],
      );
      const profile = rows[0];
      if (!profile) throw notFound("rider_not_found", "You haven't applied to be a rider");
      const documents = await listDocuments(deps.db, user.id);
      return { ...profile, documents, missingDocuments: missingDocuments(documents) };
    });

    app.post("/me/documents/:kind", { preHandler: guard("rider") }, async (req, reply) => {
      const user = currentUser(req);
      const { kind } = documentParams.parse(req.params);
      await assertEditable(deps.db, user.id);

      const file = await req.file({ limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } });
      if (!file) throw badRequest("file_required", "Attach the document as a file");
      let data: Buffer;
      try {
        data = await file.toBuffer();
      } catch (err) {
        if (err instanceof app.multipartErrors.RequestFileTooLargeError) {
          throw new AppError(413, "file_too_large", "Files must be 5 MB or smaller");
        }
        throw err;
      }

      const type = detectFileType(data);
      if (!type) throw new AppError(415, "unsupported_file_type", "Upload a JPEG, PNG or PDF");
      if (kind === "selfie" && !type.isImage) {
        throw new AppError(415, "unsupported_file_type", "Your selfie must be a JPEG or PNG photo");
      }

      const key = `riders/${user.id}/${kind}-${randomUUID()}.${type.ext}`;
      await deps.storage.put(key, data);

      let result: { document: DocumentRow; replacedKeys: string[] };
      try {
        result = await withTransaction(deps.db, async (client) => {
          await assertEditable(client, user.id, true);
          const old = await client.query<{ file_key: string }>(
            "DELETE FROM rider_documents WHERE rider_id = $1 AND kind = $2 RETURNING file_key",
            [user.id, kind],
          );
          const { rows } = await client.query<DocumentRow>(
            `INSERT INTO rider_documents (rider_id, kind, file_key, content_type, size_bytes)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING ${DOCUMENT_COLUMNS}`,
            [user.id, kind, key, type.contentType, data.length],
          );
          return { document: rows[0]!, replacedKeys: old.rows.map((r) => r.file_key) };
        });
      } catch (err) {
        await deps.storage.delete(key);
        throw err;
      }

      // Removed after commit so a failed upload never loses the earlier file.
      for (const oldKey of result.replacedKeys) {
        await deps.storage.delete(oldKey).catch((err) => req.log.warn({ err, key: oldKey }, "Failed to delete replaced document"));
      }
      return reply.code(201).send(result.document);
    });
  };
}

/** Documents can only change while the application is waiting for review. */
async function assertEditable(db: Pick<DbClient, "query">, userId: string, lock = false): Promise<void> {
  const { rows } = await db.query<{ status: RiderStatus }>(
    `SELECT status FROM rider_profiles WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
  if (rows[0]?.status !== "pending") {
    throw conflict("profile_not_editable", "Documents can only be changed while your application is pending");
  }
}
