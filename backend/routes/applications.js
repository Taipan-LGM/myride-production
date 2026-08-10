import express from "express";
import { z } from "zod";
import { db } from "../database.js";

const router = express.Router();

const digitsExact = (len) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${len}}$`), `Must be exactly ${len} digits`);

const applicationSchema = z.object({
  applicant_name: z.string().trim().min(2).max(60),
  applicant_surname: z.string().trim().min(2).max(60),
  id_number: digitsExact(13),
  contact_number: digitsExact(10),
  address: z.string().trim().min(5).max(120),
  suburb: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  postal_code: digitsExact(6),
  driving_experience_years: z.number().int().min(0).max(80),
  id_document_ref: z.string().trim().min(1).max(300).optional().nullable(),
  license_pdp_ref: z.string().trim().min(1).max(300).optional().nullable(),
  comments: z.string().trim().max(600).optional().nullable(),
});

router.post("/", (req, res) => {
  const parsed = applicationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "invalid_input", details: parsed.error.flatten() });
  }

  const a = parsed.data;

  const info = db
    .prepare(
      `
      INSERT INTO driver_applications (
        applicant_name, applicant_surname, id_number, contact_number,
        address, suburb, city, postal_code, driving_experience_years,
        id_document_ref, license_pdp_ref, comments, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
    `
    )
    .run(
      a.applicant_name,
      a.applicant_surname,
      a.id_number,
      a.contact_number,
      a.address,
      a.suburb,
      a.city,
      a.postal_code,
      a.driving_experience_years,
      a.id_document_ref || null,
      a.license_pdp_ref || null,
      a.comments || null
    );

  return res.status(201).json({ ok: true, application_id: Number(info.lastInsertRowid) });
});

export default router;

