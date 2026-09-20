import fs from 'node:fs';
import path from 'node:path';
import { q, transaction, nowIso, bool } from '../db/connection.js';
import { config } from '../config.js';
import { audit } from './audit.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { notify } from '../realtime/hub.js';
import { getRestaurant } from './restaurant.js';
import { formatMoney } from './money.js';
import { MENU_FIELD_FA, joinFa } from './labels.js';

/* ───────────────────────────── Categories ───────────────────────────── */

const toCategoryDto = (c) => ({
  id: c.id,
  name: c.name,
  sortOrder: c.sort_order,
  isActive: !!c.is_active,
  itemCount: c.item_count ?? undefined,
});

export function listCategories(actor, { includeInactive = false } = {}) {
  return q
    .all(
      `SELECT c.*, (SELECT COUNT(*) FROM menu_items mi WHERE mi.category_id = c.id AND mi.deleted_at IS NULL) AS item_count
         FROM menu_categories c
        WHERE c.restaurant_id = ? AND c.deleted_at IS NULL ${includeInactive ? '' : 'AND c.is_active = 1'}
        ORDER BY c.sort_order, c.name`,
      actor.restaurantId,
    )
    .map(toCategoryDto);
}

function getCategory(actor, id) {
  const c = q.get('SELECT * FROM menu_categories WHERE id = ? AND restaurant_id = ? AND deleted_at IS NULL', id, actor.restaurantId);
  if (!c) throw notFound('دسته‌بندی یافت نشد');
  return c;
}

function assertCategoryNameFree(actor, name, exceptId = 0) {
  if (q.get('SELECT 1 AS x FROM menu_categories WHERE restaurant_id = ? AND name = ? AND deleted_at IS NULL AND id != ?', actor.restaurantId, name, exceptId)) {
    throw conflict(`دسته‌بندی «${name}» وجود دارد`);
  }
}

export function createCategory(actor, input) {
  const result = transaction(() => {
    assertCategoryNameFree(actor, input.name);
    const now = nowIso();
    const sortOrder = input.sortOrder ?? q.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM menu_categories WHERE restaurant_id = ?', actor.restaurantId).n;
    const { lastInsertRowid } = q.run(
      'INSERT INTO menu_categories (restaurant_id, name, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      actor.restaurantId,
      input.name,
      sortOrder,
      bool(input.isActive ?? true),
      now,
      now,
    );
    const id = Number(lastInsertRowid);
    audit(actor, { action: 'category.create', entityType: 'category', entityId: id, summary: `${actor.name} دسته‌بندی ${input.name} را ایجاد کرد` });
    return toCategoryDto(getCategory(actor, id));
  });
  notify.menuChanged(actor.restaurantId);
  return result;
}

export function updateCategory(actor, id, input) {
  const result = transaction(() => {
    const current = getCategory(actor, id);
    if (input.name) assertCategoryNameFree(actor, input.name, id);
    q.run(
      'UPDATE menu_categories SET name = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?',
      input.name ?? current.name,
      input.sortOrder ?? current.sort_order,
      input.isActive === undefined ? current.is_active : bool(input.isActive),
      nowIso(),
      id,
    );
    audit(actor, {
      action: 'category.update',
      entityType: 'category',
      entityId: id,
      summary: `${actor.name} دسته‌بندی ${current.name} را ویرایش کرد${input.name && input.name !== current.name ? ` (نام جدید: ${input.name})` : ''}`,
      metadata: input,
    });
    return toCategoryDto(getCategory(actor, id));
  });
  notify.menuChanged(actor.restaurantId);
  return result;
}

export function deleteCategory(actor, id) {
  const result = transaction(() => {
    const current = getCategory(actor, id);
    const live = q.get('SELECT COUNT(*) AS n FROM menu_items WHERE category_id = ? AND deleted_at IS NULL', id).n;
    if (live > 0) throw conflict(`این دسته‌بندی هنوز ${live} آیتم دارد؛ ابتدا آن‌ها را منتقل یا حذف کنید`);
    const referenced =
      q.get('SELECT 1 AS x FROM menu_items WHERE category_id = ? LIMIT 1', id) || q.get('SELECT 1 AS x FROM order_items WHERE category_id = ? LIMIT 1', id);
    if (referenced) {
      q.run('UPDATE menu_categories SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
    } else {
      q.run('DELETE FROM menu_categories WHERE id = ?', id);
    }
    audit(actor, { action: 'category.delete', entityType: 'category', entityId: id, summary: `${actor.name} دسته‌بندی ${current.name} را حذف کرد` });
    return { id };
  });
  notify.menuChanged(actor.restaurantId);
  return result;
}

/* ───────────────────────────── Items ───────────────────────────── */

const ITEM_SELECT = `
  SELECT mi.*, c.name AS category_name, c.is_active AS category_active, s.name AS station_name, s.code AS station_code
    FROM menu_items mi
    JOIN menu_categories c ON c.id = mi.category_id
    JOIN stations s ON s.id = mi.station_id`;

export const toItemDto = (i) => ({
  id: i.id,
  name: i.name,
  description: i.description,
  price: i.price,
  itemType: i.item_type,
  imageUrl: i.image_path ? `/uploads/${i.image_path}` : null,
  categoryId: i.category_id,
  categoryName: i.category_name,
  stationId: i.station_id,
  stationName: i.station_name,
  stationCode: i.station_code,
  isActive: !!i.is_active,
  isAvailable: !!i.is_available,
  sortOrder: i.sort_order,
  updatedAt: i.updated_at,
});

/** Waiters get the orderable menu; managers can ask for everything (inactive included). */
export function listItems(actor, { includeInactive = false } = {}) {
  const activeFilter = includeInactive ? '' : 'AND mi.is_active = 1 AND c.is_active = 1';
  return q
    .all(`${ITEM_SELECT} WHERE mi.restaurant_id = ? AND mi.deleted_at IS NULL ${activeFilter} ORDER BY c.sort_order, mi.sort_order, mi.name`, actor.restaurantId)
    .map(toItemDto);
}

function getItemRow(actor, id) {
  const i = q.get(`${ITEM_SELECT} WHERE mi.id = ? AND mi.restaurant_id = ? AND mi.deleted_at IS NULL`, id, actor.restaurantId);
  if (!i) throw notFound('آیتم منو یافت نشد');
  return i;
}

function assertRefs(actor, { categoryId, stationId }) {
  if (categoryId !== undefined && !q.get('SELECT 1 AS x FROM menu_categories WHERE id = ? AND restaurant_id = ? AND deleted_at IS NULL', categoryId, actor.restaurantId)) {
    throw badRequest('دسته‌بندی نامعتبر است');
  }
  if (stationId !== undefined && !q.get('SELECT 1 AS x FROM stations WHERE id = ? AND restaurant_id = ? AND is_active = 1', stationId, actor.restaurantId)) {
    throw badRequest('محل آماده‌سازی نامعتبر یا غیرفعال است');
  }
}

export function createItem(actor, input) {
  const result = transaction(() => {
    assertRefs(actor, input);
    const now = nowIso();
    const { lastInsertRowid } = q.run(
      `INSERT INTO menu_items (restaurant_id, category_id, station_id, name, description, price, item_type, is_active, is_available, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      actor.restaurantId,
      input.categoryId,
      input.stationId,
      input.name,
      input.description ?? '',
      input.price,
      input.itemType ?? 'FOOD',
      bool(input.isActive ?? true),
      bool(input.isAvailable ?? true),
      input.sortOrder ?? 0,
      now,
      now,
    );
    const id = Number(lastInsertRowid);
    const restaurant = getRestaurant(actor.restaurantId);
    audit(actor, {
      action: 'menu_item.create',
      entityType: 'menu_item',
      entityId: id,
      summary: `${actor.name} آیتم ${input.name} (${formatMoney(restaurant, input.price)}) را به منو اضافه کرد`,
    });
    return toItemDto(getItemRow(actor, id));
  });
  notify.menuChanged(actor.restaurantId);
  return result;
}

const ITEM_FIELDS = {
  name: 'name',
  description: 'description',
  price: 'price',
  itemType: 'item_type',
  categoryId: 'category_id',
  stationId: 'station_id',
  isActive: 'is_active',
  isAvailable: 'is_available',
  sortOrder: 'sort_order',
};

export function updateItem(actor, id, input) {
  const result = transaction(() => {
    const current = getItemRow(actor, id);
    assertRefs(actor, input);
    const changed = {};
    for (const [field, column] of Object.entries(ITEM_FIELDS)) {
      if (input[field] === undefined) continue;
      const value = typeof input[field] === 'boolean' ? bool(input[field]) : input[field];
      if (value !== current[column]) changed[column] = value;
    }
    if (Object.keys(changed).length === 0) return toItemDto(current);

    const sets = Object.keys(changed).map((c) => `${c} = ?`).join(', ');
    q.run(`UPDATE menu_items SET ${sets}, updated_at = ? WHERE id = ?`, ...Object.values(changed), nowIso(), id);

    const restaurant = getRestaurant(actor.restaurantId);
    if ('price' in changed) {
      audit(actor, {
        action: 'menu_item.price_change',
        entityType: 'menu_item',
        entityId: id,
        summary: `${actor.name} قیمت ${current.name} را از ${formatMoney(restaurant, current.price)} به ${formatMoney(restaurant, changed.price)} تغییر داد`,
        metadata: { before: current.price, after: changed.price },
      });
    }
    const others = Object.keys(changed).filter((c) => c !== 'price');
    if (others.length) {
      audit(actor, {
        action: 'menu_item.update',
        entityType: 'menu_item',
        entityId: id,
        summary: `${actor.name} آیتم ${current.name} را ویرایش کرد (${joinFa(others.map((c) => MENU_FIELD_FA[c] ?? c))})`,
        metadata: { before: Object.fromEntries(others.map((c) => [c, current[c]])), after: Object.fromEntries(others.map((c) => [c, changed[c]])) },
      });
    }
    return toItemDto(getItemRow(actor, id));
  });
  notify.menuChanged(actor.restaurantId);
  return result;
}

export function setAvailability(actor, id, isAvailable) {
  const result = transaction(() => {
    const current = getItemRow(actor, id);
    if (!!current.is_available === isAvailable) return toItemDto(current);
    q.run('UPDATE menu_items SET is_available = ?, updated_at = ? WHERE id = ?', bool(isAvailable), nowIso(), id);
    audit(actor, {
      action: 'menu_item.availability',
      entityType: 'menu_item',
      entityId: id,
      summary: `${actor.name} ${current.name} را ${isAvailable ? 'موجود' : 'ناموجود'} کرد`,
    });
    return toItemDto(getItemRow(actor, id));
  });
  notify.menuChanged(actor.restaurantId);
  return result;
}

function removeImageFile(imagePath) {
  if (!imagePath) return;
  const full = path.resolve(config.uploadDir, imagePath);
  if (!full.startsWith(path.resolve(config.uploadDir))) return;
  fs.rm(full, { force: true }, () => {});
}

export function deleteItem(actor, id) {
  let imageToRemove = null;
  const result = transaction(() => {
    const current = getItemRow(actor, id);
    const ordered = q.get('SELECT 1 AS x FROM order_items WHERE menu_item_id = ? LIMIT 1', id);
    if (ordered) {
      q.run('UPDATE menu_items SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
    } else {
      q.run('DELETE FROM menu_items WHERE id = ?', id);
      imageToRemove = current.image_path;
    }
    audit(actor, { action: 'menu_item.delete', entityType: 'menu_item', entityId: id, summary: `${actor.name} آیتم ${current.name} را از منو حذف کرد` });
    return { id };
  });
  removeImageFile(imageToRemove);
  notify.menuChanged(actor.restaurantId);
  return result;
}

export function setItemImage(actor, id, relativePath) {
  let old = null;
  const result = transaction(() => {
    const current = getItemRow(actor, id);
    old = current.image_path;
    q.run('UPDATE menu_items SET image_path = ?, updated_at = ? WHERE id = ?', relativePath, nowIso(), id);
    audit(actor, {
      action: 'menu_item.image',
      entityType: 'menu_item',
      entityId: id,
      summary: `${actor.name} تصویر ${current.name} را ${relativePath ? 'به‌روزرسانی' : 'حذف'} کرد`,
    });
    return toItemDto(getItemRow(actor, id));
  });
  if (old && old !== relativePath) removeImageFile(old);
  notify.menuChanged(actor.restaurantId);
  return result;
}
