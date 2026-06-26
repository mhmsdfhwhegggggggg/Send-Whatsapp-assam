import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import api from "@/lib/api";
import { toast } from "sonner";
import { Plus, Send, Play, Pause, Trash2, ChevronLeft } from "lucide-react";

interface Campaign { id: string; name: string; status: string; sent: number; failed: number; pending: number; total: number; }
interface Group { id: string; name: string; count: number; }
interface Template { id: string; name: string; }
interface Account { id: string; label: string; status: string; }

const STATUS_BADGE: Record<string, [string, string]> = {
  running: ["bg-emerald-50 text-emerald-700 border-emerald-200", "قيد التشغيل"],
  completed: ["bg-blue-50 text-blue-700 border-blue-200", "مكتملة"],
  paused: ["bg-amber-50 text-amber-700 border-amber-200", "متوقفة مؤقتاً"],
  pending: ["bg-slate-100 text-slate-600 border-slate-200", "بانتظار البدء"],
};

export default function Campaigns() {
  const [list, setList] = useState<Campaign[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [, nav] = useLocation();
  const [form, setForm] = useState({
    name: "", template_id: "", group_ids: [] as string[], account_ids: [] as string[],
    min_delay_sec: 5, max_delay_sec: 25, batch_size: 50, batch_pause_min: 5,
  });

  const load = () => api.get("/campaigns").then(r => setList(r.data as Campaign[]));
  useEffect(() => {
    load();
    api.get("/groups").then(r => setGroups(r.data as Group[]));
    api.get("/templates").then(r => setTemplates(r.data as Template[]));
    api.get("/accounts").then(r => setAccounts(r.data as Account[]));
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const toggle = (key: "group_ids" | "account_ids", id: string) => {
    setForm(f => ({ ...f, [key]: f[key].includes(id) ? f[key].filter(x => x !== id) : [...f[key], id] }));
  };

  const create = async () => {
    if (!form.name || !form.template_id || !form.account_ids.length || !form.group_ids.length) {
      return toast.error("املأ جميع الحقول واختر مجموعة وحساباً");
    }
    try {
      const r = await api.post("/campaigns", form);
      toast.success("تم إنشاء الحملة وبدأ الإرسال");
      setOpen(false); load();
      nav(`/campaigns/${(r.data as Campaign).id}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? "فشل الإنشاء");
    }
  };

  const pause = async (id: string) => { await api.post(`/campaigns/${id}/pause`); load(); };
  const start = async (id: string) => { await api.post(`/campaigns/${id}/start`); load(); };
  const del = async (id: string) => {
    if (!window.confirm("حذف الحملة وجميع رسائلها؟")) return;
    await api.delete(`/campaigns/${id}`); load();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">الحملات</h1>
          <p className="text-sm text-slate-500 mt-1">إنشاء وإدارة حملات الإرسال الجماعي</p>
        </div>
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E]">
          <Plus className="w-4 h-4" /> حملة جديدة
        </button>
      </header>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-right">
            <tr>
              <th className="px-4 py-3 font-semibold">اسم الحملة</th>
              <th className="px-4 py-3 font-semibold">الحالة</th>
              <th className="px-4 py-3 font-semibold hidden md:table-cell">التقدم</th>
              <th className="px-4 py-3 font-semibold hidden sm:table-cell">الإرسال</th>
              <th className="px-4 py-3 font-semibold w-28">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && <tr><td colSpan={5} className="text-center py-16 text-slate-400">
              <Send className="w-12 h-12 mx-auto mb-2 opacity-40" />لا توجد حملات بعد
            </td></tr>}
            {list.map(c => {
              const pct = c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0;
              const [cls, lbl] = STATUS_BADGE[c.status] ?? STATUS_BADGE.pending;
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/campaigns/${c.id}`} className="text-slate-900 hover:text-[#1B7A3D]">{c.name}</Link>
                  </td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${cls}`}>{lbl}</span></td>
                  <td className="px-4 py-3 w-52 hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#1B7A3D]" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs tabular-nums font-medium">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-xs text-slate-600 hidden sm:table-cell">
                    <span className="text-emerald-700">{c.sent ?? 0}</span> / {c.total ?? 0}
                    {(c.failed ?? 0) > 0 && <span className="text-red-600 ms-2">({c.failed} فشل)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {c.status === "running"
                        ? <button onClick={() => pause(c.id)} className="p-1.5 rounded hover:bg-slate-100"><Pause className="w-4 h-4" /></button>
                        : c.status !== "completed" && <button onClick={() => start(c.id)} className="p-1.5 rounded hover:bg-slate-100 text-[#1B7A3D]"><Play className="w-4 h-4" /></button>}
                      <button onClick={() => del(c.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 className="w-4 h-4" /></button>
                      <Link href={`/campaigns/${c.id}`}><button className="p-1.5 rounded hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button></Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4" dir="rtl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold">حملة إرسال جديدة</h2>
            <div>
              <label className="block text-sm font-medium mb-1">اسم الحملة *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">قالب الرسالة *</label>
              <select value={form.template_id} onChange={e => setForm({ ...form, template_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]">
                <option value="">اختر قالباً</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">المجموعات المستهدفة *</label>
              <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                {groups.length === 0 && <p className="text-xs text-slate-400">لا توجد مجموعات</p>}
                {groups.map(g => (
                  <label key={g.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input type="checkbox" checked={form.group_ids.includes(g.id)} onChange={() => toggle("group_ids", g.id)} className="accent-[#1B7A3D]" />
                    <span className="text-sm">{g.name}</span>
                    <span className="text-xs text-slate-400 mr-auto">{g.count} مستفيد</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">حسابات الإرسال *</label>
              <div className="border rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                {accounts.length === 0 && <p className="text-xs text-slate-400">لا توجد حسابات. اربط حساباً أولاً</p>}
                {accounts.map(a => (
                  <label key={a.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input type="checkbox" checked={form.account_ids.includes(a.id)} onChange={() => toggle("account_ids", a.id)} className="accent-[#1B7A3D]" />
                    <span className="text-sm">{a.label}</span>
                    <span className={`text-xs mr-auto px-2 py-0.5 rounded ${a.status === "connected" ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"}`}>
                      {a.status === "connected" ? "متصل" : "غير متصل"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "أدنى تأخير (ث)", key: "min_delay_sec" },
                { label: "أقصى تأخير (ث)", key: "max_delay_sec" },
                { label: "حجم الدفعة", key: "batch_size" },
                { label: "راحة بعد الدفعة (د)", key: "batch_pause_min" },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label className="block text-xs font-medium mb-1">{label}</label>
                  <input type="number" value={(form as Record<string, number | string>)[key] as number}
                    onChange={e => setForm({ ...form, [key]: +e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setOpen(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50">إلغاء</button>
              <button onClick={create} className="flex-1 px-4 py-2 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E]">إنشاء وبدء الإرسال</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
