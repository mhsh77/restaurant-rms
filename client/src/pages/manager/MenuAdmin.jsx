import { useMemo, useState } from 'react';
import { ImagePlus, Pencil, Plus, Search, Trash2, UtensilsCrossed } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useAction, useLiveQuery } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';
import { faNumber, minorToInput, parseMoney } from '../../lib/format.js';
import { ConfirmDialog, Empty, ErrorBlock, Field, ItemThumb, LoadingBlock, Modal, PageHeader, Toggle } from '../../components/ui.jsx';

const ITEM_TYPES = { FOOD: 'غذا', DRINK: 'نوشیدنی', NON_FOOD: 'غیرغذایی' };

export default function MenuAdmin() {
  const { money } = useAuth();
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const [tab, setTab] = useState('items');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [deleting, setDeleting] = useState(null); // { kind, entity }

  const q = useLiveQuery(
    () => Promise.all([api.get('/menu/items?all=1'), api.get('/menu/categories?all=1'), api.get('/stations')]),
    [],
    { events: ['menu:changed'], intervalMs: 0 },
  );
  const [items, categories, stations] = q.data ?? [[], [], []];

  const filtered = useMemo(() => {
    const term = search.trim();
    return items.filter((i) => (!categoryFilter || i.categoryId === Number(categoryFilter)) && (!term || i.name.includes(term)));
  }, [items, search, categoryFilter]);

  if (q.loading && !q.data) return <LoadingBlock />;
  if (q.error && !q.data) return <ErrorBlock error={q.error} onRetry={q.reload} />;

  const quickToggle = (item, patch, success) =>
    run(async () => {
      if ('isAvailable' in patch) await api.patch(`/menu/items/${item.id}/availability`, patch);
      else await api.put(`/menu/items/${item.id}`, patch);
      await q.reload();
    }, { success });

  return (
    <div className="page">
      <PageHeader
        title="منو"
        subtitle={`${faNumber(items.length)} آیتم در ${faNumber(categories.length)} دسته‌بندی`}
        actions={
          tab === 'items' ? (
            <button type="button" className="btn btn-primary" onClick={() => setEditing({})} disabled={!categories.length}>
              <Plus size={18} /> آیتم جدید
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setEditingCategory({})}>
              <Plus size={18} /> دسته‌بندی جدید
            </button>
          )
        }
      />
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'items'} className={tab === 'items' ? 'is-active' : ''} onClick={() => setTab('items')}>
          آیتم‌ها
        </button>
        <button type="button" role="tab" aria-selected={tab === 'categories'} className={tab === 'categories' ? 'is-active' : ''} onClick={() => setTab('categories')}>
          دسته‌بندی‌ها
        </button>
      </div>

      {tab === 'items' && (
        <>
          <div className="filters card">
            <label className="search grow">
              <Search size={20} aria-hidden />
              <input type="search" placeholder="جستجوی آیتم" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="جستجوی آیتم" />
            </label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="دسته‌بندی">
              <option value="">همه دسته‌بندی‌ها</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {filtered.length === 0 ? (
            <Empty icon={UtensilsCrossed} title="آیتمی وجود ندارد" />
          ) : (
            <div className="card table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>آیتم</th>
                    <th>دسته‌بندی</th>
                    <th>محل آماده‌سازی</th>
                    <th className="num">قیمت</th>
                    <th>نمایش</th>
                    <th>موجود</th>
                    <th aria-label="عملیات" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr key={item.id} className={!item.isActive ? 'is-dim' : ''}>
                      <td>
                        <div className="cell-item">
                          <ItemThumb item={item} size={44} />
                          <div>
                            <b>{item.name}</b>
                            <div className="muted small">
                              {ITEM_TYPES[item.itemType]}
                              {item.description && ` · ${item.description}`}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>{item.categoryName}</td>
                      <td>{item.stationName}</td>
                      <td className="num">
                        <b>{money(item.price)}</b>
                      </td>
                      <td>
                        <Toggle checked={item.isActive} disabled={busy} onChange={(v) => quickToggle(item, { isActive: v }, `${item.name} ${v ? 'در منو نمایش داده می‌شود' : 'از منو پنهان شد'}`)} label={<span className="sr-only">نمایش در منو</span>} />
                      </td>
                      <td>
                        <Toggle checked={item.isAvailable} disabled={busy} onChange={(v) => quickToggle(item, { isAvailable: v }, `${item.name} ${v ? 'موجود' : 'ناموجود'} شد`)} label={<span className="sr-only">موجود</span>} />
                      </td>
                      <td className="row-actions">
                        <button type="button" className="icon-btn" onClick={() => setEditing(item)} aria-label={`ویرایش ${item.name}`}>
                          <Pencil size={18} />
                        </button>
                        <button type="button" className="icon-btn danger" onClick={() => setDeleting({ kind: 'item', entity: item })} aria-label={`حذف ${item.name}`}>
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'categories' && (
        <div className="card table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>دسته‌بندی</th>
                <th className="num">تعداد آیتم</th>
                <th className="num">ترتیب</th>
                <th>فعال</th>
                <th aria-label="عملیات" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className={!c.isActive ? 'is-dim' : ''}>
                  <td>
                    <b>{c.name}</b>
                  </td>
                  <td className="num">{faNumber(c.itemCount)}</td>
                  <td className="num">{faNumber(c.sortOrder)}</td>
                  <td>
                    <Toggle
                      checked={c.isActive}
                      disabled={busy}
                      onChange={(v) => run(async () => { await api.put(`/menu/categories/${c.id}`, { isActive: v }); await q.reload(); })}
                      label={<span className="sr-only">فعال</span>}
                    />
                  </td>
                  <td className="row-actions">
                    <button type="button" className="icon-btn" onClick={() => setEditingCategory(c)} aria-label={`ویرایش ${c.name}`}>
                      <Pencil size={18} />
                    </button>
                    <button type="button" className="icon-btn danger" onClick={() => setDeleting({ kind: 'category', entity: c })} aria-label={`حذف ${c.name}`}>
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <ItemEditor item={editing} categories={categories} stations={stations} onClose={() => setEditing(null)} onSaved={q.reload} />}
      {editingCategory && <CategoryEditor category={editingCategory} onClose={() => setEditingCategory(null)} onSaved={q.reload} />}

      <ConfirmDialog
        open={!!deleting}
        danger
        busy={busy}
        title={deleting?.kind === 'item' ? 'حذف آیتم' : 'حذف دسته‌بندی'}
        confirmLabel="حذف"
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          run(async () => {
            const path = deleting.kind === 'item' ? `/menu/items/${deleting.entity.id}` : `/menu/categories/${deleting.entity.id}`;
            await api.del(path);
            setDeleting(null);
            await q.reload();
          }, { success: `${deleting.entity.name} حذف شد` })
        }
        message={
          deleting?.kind === 'item'
            ? `«${deleting.entity.name}» حذف شود؟ سوابق سفارش‌های قبلی حفظ می‌شود.`
            : `دسته‌بندی «${deleting?.entity.name}» حذف شود؟ دسته‌بندی نباید آیتمی داشته باشد.`
        }
      />
    </div>
  );
}

function ItemEditor({ item, categories, stations, onClose, onSaved }) {
  const { restaurant, money } = useAuth();
  const toast = useToast();
  const decimals = restaurant?.currencyDecimals ?? 0;
  const isNew = !item.id;
  const [form, setForm] = useState({
    name: item.name ?? '',
    description: item.description ?? '',
    price: item.id ? minorToInput(item.price, decimals) : '',
    categoryId: item.categoryId ?? categories[0]?.id,
    stationId: item.stationId ?? stations[0]?.id,
    itemType: item.itemType ?? 'FOOD',
    isActive: item.isActive ?? true,
    isAvailable: item.isAvailable ?? true,
    sortOrder: item.sortOrder ?? 0,
  });
  const [file, setFile] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    const price = parseMoney(form.price, decimals);
    const errs = {};
    if (!form.name.trim()) errs.name = 'نام الزامی است';
    if (price === null) errs.price = 'قیمت معتبر وارد کنید، مثلاً ۲۵۰۰۰۰';
    if (file && file.size > 2 * 1024 * 1024) errs.image = 'حجم تصویر باید حداکثر ۲ مگابایت باشد';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      price,
      categoryId: Number(form.categoryId),
      stationId: Number(form.stationId),
      itemType: form.itemType,
      isActive: form.isActive,
      isAvailable: form.isAvailable,
      sortOrder: Number(form.sortOrder) || 0,
    };
    setBusy(true);
    try {
      const saved = isNew ? await api.post('/menu/items', body) : await api.put(`/menu/items/${item.id}`, body);
      if (file) {
        const data = new FormData();
        data.append('image', file);
        await api.upload(`/menu/items/${saved.id}/image`, data);
      } else if (removeImage && item.imageUrl) {
        await api.del(`/menu/items/${saved.id}/image`);
      }
      toast.success(`${body.name} ذخیره شد`);
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const preview = file ? URL.createObjectURL(file) : removeImage ? null : item.imageUrl;
  const priceMinor = parseMoney(form.price, decimals);

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'آیتم جدید منو' : `ویرایش ${item.name}`}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            انصراف
          </button>
          <button type="submit" form="item-form" className="btn btn-primary" disabled={busy}>
            {isNew ? 'ایجاد آیتم' : 'ذخیره تغییرات'}
          </button>
        </>
      }
    >
      <form id="item-form" className="form-grid two" onSubmit={save}>
        <Field label="نام" error={errors.name}>
          <input value={form.name} onChange={set('name')} maxLength={80} autoFocus />
        </Field>
        <Field label={`قیمت (${restaurant?.currencySymbol})`} error={errors.price} hint={priceMinor !== null && form.price ? money(priceMinor) : undefined}>
          <input dir="ltr" inputMode="decimal" value={form.price} onChange={set('price')} placeholder="0" />
        </Field>
        <Field label="دسته‌بندی">
          <select value={form.categoryId} onChange={set('categoryId')}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="محل آماده‌سازی" hint="سفارش‌های این آیتم خودکار به این بخش ارسال می‌شوند">
          <select value={form.stationId} onChange={set('stationId')}>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="نوع">
          <select value={form.itemType} onChange={set('itemType')}>
            {Object.entries(ITEM_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ترتیب نمایش">
          <input type="number" min={0} max={10000} value={form.sortOrder} onChange={set('sortOrder')} />
        </Field>
        <Field label="توضیحات" className="span-all">
          <textarea rows={2} maxLength={500} value={form.description} onChange={set('description')} />
        </Field>
        <div className="span-all toggles-row">
          <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="نمایش در منو" />
          <Toggle checked={form.isAvailable} onChange={(v) => setForm({ ...form, isAvailable: v })} label="موجود" />
        </div>
        <Field label="تصویر" hint="JPG، PNG یا WebP تا ۲ مگابایت" error={errors.image} className="span-all">
          <div className="image-picker">
            {preview ? <img src={preview} alt="" className="image-preview" /> : <span className="image-preview empty"><ImagePlus size={28} /></span>}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { setFile(e.target.files[0] ?? null); setRemoveImage(false); }} />
            {(item.imageUrl || file) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFile(null); setRemoveImage(true); }}>
                حذف تصویر
              </button>
            )}
          </div>
        </Field>
      </form>
    </Modal>
  );
}

function CategoryEditor({ category, onClose, onSaved }) {
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const [name, setName] = useState(category.name ?? '');
  const [sortOrder, setSortOrder] = useState(category.sortOrder ?? '');
  const isNew = !category.id;

  const save = (e) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('نام الزامی است');
    return run(async () => {
      const body = { name: name.trim(), ...(sortOrder !== '' ? { sortOrder: Number(sortOrder) } : {}) };
      if (isNew) await api.post('/menu/categories', body);
      else await api.put(`/menu/categories/${category.id}`, body);
      await onSaved();
      onClose();
    }, { success: 'دسته‌بندی ذخیره شد' });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'دسته‌بندی جدید' : `ویرایش ${category.name}`}
      size="sm"
      footer={
        <button type="submit" form="category-form" className="btn btn-primary" disabled={busy}>
          ذخیره
        </button>
      }
    >
      <form id="category-form" className="form-grid" onSubmit={save}>
        <Field label="نام">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus />
        </Field>
        <Field label="ترتیب نمایش" hint="عدد کوچک‌تر زودتر نمایش داده می‌شود">
          <input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
