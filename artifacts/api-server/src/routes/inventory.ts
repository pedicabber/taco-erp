import { Router, type IRouter } from "express";
import { db, inventoryItemsTable, inventoryAllocationsTable, projectsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { syncUserFromClerk } from "../lib/userSync";

const router: IRouter = Router();

// ── List all inventory items ─────────────────────────────────────────────────
router.get("/inventory", requireAuth, async (_req, res): Promise<void> => {
  const items = await db.select().from(inventoryItemsTable).orderBy(inventoryItemsTable.name);

  // Compute allocated qty per item
  const allocRows = await db
    .select({
      inventoryItemId: inventoryAllocationsTable.inventoryItemId,
      total: sql<number>`sum(${inventoryAllocationsTable.quantity})`,
    })
    .from(inventoryAllocationsTable)
    .groupBy(inventoryAllocationsTable.inventoryItemId);

  const allocMap = new Map(allocRows.map(r => [r.inventoryItemId, Number(r.total)]));

  res.json(
    items.map(item => ({
      ...item,
      allocatedQty: allocMap.get(item.id) ?? 0,
      availableQty: item.quantity - (allocMap.get(item.id) ?? 0),
    })),
  );
});

// ── Get single item ───────────────────────────────────────────────────────────
router.get("/inventory/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [item] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  if (!item) { res.status(404).json({ error: "Not found" }); return; }

  const allocRows = await db
    .select({
      id: inventoryAllocationsTable.id,
      projectId: inventoryAllocationsTable.projectId,
      quantity: inventoryAllocationsTable.quantity,
      notes: inventoryAllocationsTable.notes,
      createdAt: inventoryAllocationsTable.createdAt,
      allocatedById: inventoryAllocationsTable.allocatedById,
    })
    .from(inventoryAllocationsTable)
    .where(eq(inventoryAllocationsTable.inventoryItemId, id));

  const allocatedQty = allocRows.reduce((s, r) => s + Number(r.quantity), 0);

  res.json({
    ...item,
    allocatedQty,
    availableQty: item.quantity - allocatedQty,
    allocations: allocRows.map(r => ({ ...r, quantity: Number(r.quantity), createdAt: r.createdAt.toISOString() })),
  });
});

// ── Create item ───────────────────────────────────────────────────────────────
router.post("/inventory", requireAuth, async (req, res): Promise<void> => {
  const { sku, name, category, quantity, unit, unitCost, supplier, location, minQty, notes } = req.body as {
    sku: string; name: string; category?: string; quantity?: number; unit?: string;
    unitCost?: string; supplier?: string; location?: string; minQty?: number; notes?: string;
  };

  if (!sku || !name) { res.status(400).json({ error: "sku and name required" }); return; }

  const [item] = await db.insert(inventoryItemsTable).values({
    sku, name,
    category: category ?? "General",
    quantity: quantity ?? 0,
    unit: unit ?? "ea",
    unitCost: unitCost ?? null,
    supplier: supplier ?? null,
    location: location ?? null,
    minQty: minQty ?? 0,
    notes: notes ?? null,
  }).returning();

  res.status(201).json(item);
});

// ── Update item ───────────────────────────────────────────────────────────────
router.patch("/inventory/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { sku, name, category, quantity, unit, unitCost, supplier, location, minQty, notes } = req.body as Partial<{
    sku: string; name: string; category: string; quantity: number; unit: string;
    unitCost: string; supplier: string; location: string; minQty: number; notes: string;
  }>;

  const patch: Record<string, unknown> = {};
  if (sku !== undefined) patch.sku = sku;
  if (name !== undefined) patch.name = name;
  if (category !== undefined) patch.category = category;
  if (quantity !== undefined) patch.quantity = quantity;
  if (unit !== undefined) patch.unit = unit;
  if (unitCost !== undefined) patch.unitCost = unitCost;
  if (supplier !== undefined) patch.supplier = supplier;
  if (location !== undefined) patch.location = location;
  if (minQty !== undefined) patch.minQty = minQty;
  if (notes !== undefined) patch.notes = notes;

  if (Object.keys(patch).length === 0) { res.json({ ok: true }); return; }

  const [updated] = await db.update(inventoryItemsTable).set(patch).where(eq(inventoryItemsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── Delete item ───────────────────────────────────────────────────────────────
router.delete("/inventory/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  await db.delete(inventoryAllocationsTable).where(eq(inventoryAllocationsTable.inventoryItemId, id));
  await db.delete(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  res.json({ ok: true });
});

// ── Allocate item to project ─────────────────────────────────────────────────
router.post("/inventory/:id/allocate", requireAuth, async (req: AuthenticatedRequest, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { projectId, quantity, notes } = req.body as { projectId: number; quantity: number; notes?: string };

  if (!projectId || quantity == null || quantity <= 0) {
    res.status(400).json({ error: "projectId and positive quantity required" });
    return;
  }

  const dbUser = await syncUserFromClerk(req);

  // Check item exists and has enough available qty
  const [item] = await db.select().from(inventoryItemsTable).where(eq(inventoryItemsTable.id, id));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }

  const [allocSumRow] = await db
    .select({ total: sql<number>`coalesce(sum(${inventoryAllocationsTable.quantity}), 0)` })
    .from(inventoryAllocationsTable)
    .where(eq(inventoryAllocationsTable.inventoryItemId, id));

  const alreadyAllocated = Number(allocSumRow?.total ?? 0);
  const available = item.quantity - alreadyAllocated;

  if (quantity > available) {
    res.status(400).json({ error: `Only ${available} ${item.unit} available` });
    return;
  }

  const [alloc] = await db.insert(inventoryAllocationsTable).values({
    inventoryItemId: id,
    projectId,
    quantity,
    notes: notes ?? null,
    allocatedById: dbUser.id,
  }).returning();

  res.status(201).json({ ...alloc, quantity: Number(alloc.quantity), createdAt: alloc.createdAt.toISOString() });
});

// ── Remove allocation ─────────────────────────────────────────────────────────
router.delete("/inventory/allocations/:allocId", requireAuth, async (req, res): Promise<void> => {
  const allocId = parseInt(req.params.allocId, 10);
  await db.delete(inventoryAllocationsTable).where(eq(inventoryAllocationsTable.id, allocId));
  res.json({ ok: true });
});

// ── Get allocations for a project ────────────────────────────────────────────
router.get("/projects/:projectId/inventory", requireAuth, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);

  const rows = await db
    .select({
      allocationId: inventoryAllocationsTable.id,
      quantity: inventoryAllocationsTable.quantity,
      notes: inventoryAllocationsTable.notes,
      createdAt: inventoryAllocationsTable.createdAt,
      itemId: inventoryItemsTable.id,
      sku: inventoryItemsTable.sku,
      name: inventoryItemsTable.name,
      category: inventoryItemsTable.category,
      unit: inventoryItemsTable.unit,
      unitCost: inventoryItemsTable.unitCost,
    })
    .from(inventoryAllocationsTable)
    .innerJoin(inventoryItemsTable, eq(inventoryAllocationsTable.inventoryItemId, inventoryItemsTable.id))
    .where(eq(inventoryAllocationsTable.projectId, projectId))
    .orderBy(inventoryItemsTable.name);

  res.json(
    rows.map(r => ({
      allocationId: r.allocationId,
      quantity: Number(r.quantity),
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      item: { id: r.itemId, sku: r.sku, name: r.name, category: r.category, unit: r.unit, unitCost: r.unitCost },
    })),
  );
});

export default router;
