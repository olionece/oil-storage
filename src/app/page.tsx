'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Warehouse = { id: string; name: string };
type StockRow = { warehouse: string; year: number; lot: 'A'|'B'|'C'; size: 'ml_250'|'ml_500'|'lt_5'; qty_ml: number; approx_units: number };

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [role, setRole] = useState<'viewer'|'operator'|'admin'|null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWh, setSelectedWh] = useState<string>('all');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [email, setEmail] = useState('');

  const canOperate = role === 'operator' || role === 'admin';

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      // ruolo
      const { data: me } = await supabase.from('app_users').select('role').eq('user_id', session.user.id).maybeSingle();
      setRole(me?.role ?? null);
      // magazzini
      const { data: w } = await supabase.from('warehouses').select('id,name').order('name');
      setWarehouses(w ?? []);
      // stock
      await loadStock();
    })();
  }, [session]);

  async function loadStock(warehouseName?: string) {
    let query = supabase.from('v_stock_detailed').select('*');
    if (warehouseName && warehouseName !== 'all') query = query.eq('warehouse', warehouseName);
    const { data } = await query;
    setStock(data ?? []);
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (!error) alert('Ti ho inviato un link via email. Aprilo per accedere.');
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Gestione Olio — oil-storage</h1>

      {!session ? (
        <form onSubmit={signIn} className="flex gap-2 items-end">
          <div className="flex flex-col">
            <label className="text-sm">Email</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} className="border rounded p-2" placeholder="you@example.com" />
          </div>
          <button className="rounded px-4 py-2 border">Accedi</button>
        </form>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm">Ruolo: <b>{role ?? '...'}</b></span>
            <button onClick={signOut} className="rounded px-3 py-1 border">Esci</button>
          </div>

          <div className="flex gap-2 items-center mb-4">
            <span className="text-sm">Magazzino:</span>
            <select
              className="border rounded p-2"
              value={selectedWh}
              onChange={(e)=>{ setSelectedWh(e.target.value); loadStock(e.target.value); }}
            >
              <option value="all">Tutti</option>
              {warehouses.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
            </select>
          </div>

          <StockTable rows={stock} />

          {canOperate && <MovementForm warehouses={warehouses} onDone={()=>loadStock(selectedWh)} />}
        </>
      )}
    </main>
  );
}

function StockTable({ rows }: { rows: StockRow[] }) {
  const fmt = (n:number)=> new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(n);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border rounded">
        <thead>
          <tr className="bg-gray-50">
            <th className="p-2 border">Magazzino</th>
            <th className="p-2 border">Annata</th>
            <th className="p-2 border">Lotto</th>
            <th className="p-2 border">Formato</th>
            <th className="p-2 border">Giacenza (ml)</th>
            <th className="p-2 border">≈ Unità</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r,i)=>(
            <tr key={i}>
              <td className="p-2 border">{r.warehouse}</td>
              <td className="p-2 border">{r.year}</td>
              <td className="p-2 border">{r.lot}</td>
              <td className="p-2 border">{r.size}</td>
              <td className="p-2 border text-right">{fmt(r.qty_ml)}</td>
              <td className="p-2 border text-right">{fmt(r.approx_units)}</td>
            </tr>
          ))}
          {rows.length===0 && (
            <tr><td className="p-3 text-sm" colSpan={6}>Nessuna giacenza (registra un carico per iniziare).</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function MovementForm({ warehouses, onDone }: { warehouses: {id:string;name:string}[]; onDone: ()=>void }) {
  const [warehouseId, setWarehouseId] = useState('');
  const [year, setYear] = useState<number>(2024);
  const [lot, setLot] = useState<'A'|'B'|'C'>('A');
  const [size, setSize] = useState<'ml_250'|'ml_500'|'lt_5'>('ml_500');
  const [type, setType] = useState<'in'|'out'|'adjustment'>('in');
  const [units, setUnits] = useState<number>(1);
  const [note, setNote] = useState('');

  const qtyMl = useMemo(()=>{
    const per = size==='lt_5' ? 5000 : (size==='ml_500'? 500 : 250);
    const positive = type !== 'out';
    return (positive ? 1 : -1) * units * per;
  }, [size, units, type]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { data: product } = await supabase.from('products')
      .select('id').eq('year', year).eq('lot', lot).eq('size', size).maybeSingle();
    if (!product?.id || !warehouseId) { alert('Seleziona magazzino e prodotto.'); return; }

    const user = (await supabase.auth.getUser()).data.user;
    const { error } = await supabase.from('inventory_movements').insert({
      warehouse_id: warehouseId,
      product_id: product.id,
      movement: type,
      quantity_ml: qtyMl,
      note,
      user_id: user?.id
    });
    if (error) { alert(error.message); return; }
    setUnits(1); setNote('');
    onDone();
  }

  return (
    <form onSubmit={submit} className="mt-6 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
      <div className="flex flex-col">
        <label className="text-sm">Magazzino</label>
        <select className="border rounded p-2" value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}>
          <option value="">Seleziona</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-sm">Annata</label>
        <select className="border rounded p-2" value={year} onChange={e=>setYear(parseInt(e.target.value))}>
          <option value={2024}>2024</option>
          <option value={2025}>2025</option>
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-sm">Lotto</label>
        <select className="border rounded p-2" value={lot} onChange={e=>setLot(e.target.value as any)}>
          <option value="A">A</option><option value="B">B</option><option value="C">C</option>
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-sm">Formato</label>
        <select className="border rounded p-2" value={size} onChange={e=>setSize(e.target.value as any)}>
          <option value="ml_250">250ml</option>
          <option value="ml_500">500ml</option>
          <option value="lt_5">5LT</option>
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-sm">Tipo</label>
        <select className="border rounded p-2" value={type} onChange={e=>setType(e.target.value as any)}>
          <option value="in">Ingresso</option>
          <option value="out">Uscita</option>
          <option value="adjustment">Rettifica</option>
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-sm">Quantità (unità)</label>
        <input className="border rounded p-2" type="number" min={1} value={units} onChange={e=>setUnits(parseInt(e.target.value||'1'))}/>
      </div>
      <div className="md:col-span-4 flex flex-col">
        <label className="text-sm">Note</label>
        <input className="border rounded p-2" value={note} onChange={e=>setNote(e.target.value)} placeholder="es. carico 50 casse"/>
      </div>
      <div className="md:col-span-2">
        <button className="w-full border rounded p-2">Registra (≈ {Math.abs(qtyMl)} ml)</button>
      </div>
    </form>
  );
}

