import { z } from "zod";

export const zoneSchema = z.enum(["main", "side", "commander", "extra", "maybe", "considering", "tokens", "custom"]);

export const cardEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(99),
  zone: zoneSchema,
  provider: z.enum(["scryfall", "mpc", "custom", "local"]),
  providerId: z.string().optional(),
  setCode: z.string().optional(),
  collectorNumber: z.string().optional(),
  imageFront: z.string().optional(),
  imageBack: z.string().optional(),
  hasBack: z.boolean(),
  commander: z.boolean().optional(),
  sortOrder: z.number().int(),
});

export const printSettingsSchema = z.object({
  page: z.enum(["a3", "a4", "a5", "a6", "letter", "legal", "tabloid", "custom"]),
  pageWmm: z.number().positive().max(2000),
  pageHmm: z.number().positive().max(2000),
  orientation: z.enum(["portrait", "landscape"]),
  card: z.enum(["tcg", "ygo", "poker", "bridge", "tarot", "magic", "magic_true", "custom"]), // solo magic+custom in UI, resto back-compat
  cardWmm: z.number().positive().max(500),
  cardHmm: z.number().positive().max(500),
  marginTopMm: z.number().min(0).max(200),
  marginRightMm: z.number().min(0).max(200),
  marginBottomMm: z.number().min(0).max(200),
  marginLeftMm: z.number().min(0).max(200),
  spacingRowMm: z.number().min(0).max(100),
  spacingColMm: z.number().min(0).max(100),
  bleedMm: z.number().min(0).max(25),
  dpi: z.number().int().min(72).max(1200),
  profile: z.enum(["minimum", "balanced", "high", "maximum"]),
  guides: z.object({
    cropMarks: z.boolean(),
    cornerMarks: z.boolean(),
    cutLines: z.boolean(),
    pageLines: z.boolean(),
  }),
  guideColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "colore esadecimale tipo #ff0000"),
  guideWidthPt: z.number().min(0.25).max(3),
  guidePlacement: z.enum(["outside", "inside", "center"]),
  guideLengthMm: z.number().min(1).max(10),
  guideShape: z.enum(["cross", "inside", "outside"]),
  guideOffsetMm: z.number().min(-5).max(5),
  guideStyle: z.enum(["solid", "dashed"]),
  guideCap: z.enum(["square", "round"]),
  duplex: z.enum(["front_only", "back_only", "separate", "duplex_long", "duplex_short"]),
  upscaleMode: z.enum(["off", "ask", "auto", "always"]),
  backImage: z.string().optional(),
  // considering incluse di default (progetti storici senza campo)
  includeConsidering: z.boolean().optional().default(true),
  // luminosità: opzionale con default per i preset/progetti salvati prima
  brightnessPct: z.number().min(-50).max(50).optional().default(0),
  // legacy: accettati in lettura e migrati all'apertura (mai riscritti)
  marginMm: z.number().min(0).max(200).optional(),
  spacingMm: z.number().min(0).max(100).optional(),
  guideExtent: z.enum(["corners", "full"]).optional(),
});

export const projectManifestSchema = z.object({
  version: z.literal(1),
  deck: z.array(cardEntrySchema),
  print: printSettingsSchema,
});

export const scryfallCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  set: z.string().optional(),
  set_name: z.string().optional(),
  collector_number: z.string().optional(),
  released_at: z.string().optional(),
  highres_image: z.boolean().optional(),
  prices: z
    .object({
      usd: z.string().nullable().optional(),
      eur: z.string().nullable().optional(),
    })
    .optional(),
  image_uris: z
    .object({
      small: z.string().optional(),
      normal: z.string().optional(),
      large: z.string().optional(),
      png: z.string().optional(),
    })
    .optional(),
  card_faces: z
    .array(
      z.object({
        name: z.string().optional(),
        image_uris: z
          .object({
            small: z.string().optional(),
            normal: z.string().optional(),
            large: z.string().optional(),
            png: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export const scryfallListSchema = z.object({
  data: z.array(z.unknown()).default([]),
  has_more: z.boolean().optional(),
  next_page: z.string().optional(),
  total_cards: z.number().optional(),
});

/**
 * Schemi MINIMALI e originali per l'interoperabilità con backend
 * stile MPC Autofill (server configurabile). Validano solo i campi
 * effettivamente usati; nessun codice di terze parti copiato.
 */
export const mpcHealthSchema = z.object({ online: z.boolean() });

export const mpcCardSchema = z.object({
  identifier: z.string(),
  name: z.string(),
  dpi: z.number(),
  extension: z.string().optional(),
  language: z.string().optional(),
  smallThumbnailUrl: z.string(),
  mediumThumbnailUrl: z.string().optional(),
  sourceName: z.string().optional(),
  sourceVerbose: z.string().optional(),
  dateCreated: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** URL ufficiale full-res fornito dal backend (v2). Se assente, si deriva dal Drive ID. */
  downloadLink: z.string().optional(),
});

export const mpcEditorSearchV3Schema = z.object({
  results: z.record(z.string(), z.array(z.string())),
});

export const mpcEditorSearchV2Schema = z.object({
  results: z.record(z.string(), z.record(z.string(), z.array(z.string()))),
});

export const mpcCardsResponseSchema = z.object({
  results: z.record(z.string(), z.unknown()),
});
