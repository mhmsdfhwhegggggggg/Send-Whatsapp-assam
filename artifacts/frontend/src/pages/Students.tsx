import { useEffect, useState, useRef } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Plus, Upload, Search, Trash2, Edit, Users } from "lucide-react";

interface Student {
  id: string; name: string; phone: string; university?: string;
  serviceType?: string; discount?: string; groupId?: string;
}
interface Group { id: string; name: string; }

const emptyForm = { name: "", phone: "", university: "", serviceType: "", discount: "", groupId: "" };

export default function Students() {
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState(emptyForm);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const params: Record<string, string> = {};
    if (groupFilter !== "all") params.group_id = groupFilter;
    if (q) params.q = q;
    const r = await api.get("/students", { params });
    setStudents(r.data as Student[]);
  };

  useEffect(() => { api.get("/groups").then(r => setGroups(r.data as Group[])); }, []);
  useEffect(() => { load(); }, [groupFilter]);

  const save = async () => {
    try {
      const data = { ...form, groupId: form.groupId || null };
      if (editing) await api.put(`/students/${editing.id}`, data);
      else await api.post("/students", data);
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      setOpen(false); load();
    } catch { toast.error("فشل الحفظ"); }
  };

  const del = async (id: string) => {
    if (!window.confirm("حذف هذا المستفيد؟")) return;
    await api.delete(`/students/${id}`);
    toast.success("تم الحذف"); load();
  };

  const importCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      const r = await api.post("/students/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`تم استيراد ${(r.data as { imported: number }).imported} مستفيد`);
      load();
    } catch { toast.error("فشل الاستيراد"); }
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-900">المستفيدون</h1>
          <p className="text-sm text-slate-500 mt-1">إدارة قاعدة بيانات المستفيدين</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" hidden onChange={importCsv} />
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium hover:bg-slate-50">
            <Upload className="w-4 h-4" /> استيراد CSV
          </button>
          <button onClick={() => { setEditing(null); setForm(emptyForm); setOpen(true); }} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E]">
            <Plus className="w-4 h-4" /> إضافة مستفيد
          </button>
        </div>
      </header>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <form onSubmit={e => { e.preventDefault(); load(); }} className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="بحث بالاسم أو الهاتف"
              className="w-full pl-3 pr-9 py-2 rounded-lg border border-slate-200 text-right bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
          </div>
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]">
            <option value="all">كل المجموعات</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button type="submit" className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm hover:bg-slate-50">بحث</button>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-right">
            <tr>
              <th className="px-4 py-3 font-semibold">الاسم</th>
              <th className="px-4 py-3 font-semibold">الهاتف</th>
              <th className="px-4 py-3 font-semibold hidden md:table-cell">الجامعة</th>
              <th className="px-4 py-3 font-semibold hidden lg:table-cell">الخدمة</th>
              <th className="px-4 py-3 font-semibold hidden lg:table-cell">التخفيض</th>
              <th className="px-4 py-3 font-semibold w-24">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {students.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16 text-slate-400">
                <Users className="w-12 h-12 mx-auto mb-2 opacity-40" />
                لا يوجد مستفيدون بعد
              </td></tr>
            )}
            {students.map(s => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700" dir="ltr">{s.phone}</td>
                <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{s.university || "—"}</td>
                <td className="px-4 py-3 text-slate-600 hidden lg:table-cell">{s.serviceType || "—"}</td>
                <td className="px-4 py-3 text-slate-600 hidden lg:table-cell">{s.discount || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => { setEditing(s); setForm({ ...s, groupId: s.groupId || "" }); setOpen(true); }}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-600"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => del(s.id)}
                      className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 space-y-4" dir="rtl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold">{editing ? "تعديل مستفيد" : "إضافة مستفيد جديد"}</h2>
            {[
              { label: "الاسم *", key: "name", type: "text" },
              { label: "رقم الهاتف *", key: "phone", type: "text", dir: "ltr", placeholder: "967xxxxxxxxx" },
              { label: "الجامعة", key: "university", type: "text" },
            ].map(({ label, key, ...rest }) => (
              <div key={key}>
                <label className="block text-sm font-medium mb-1">{label}</label>
                <input {...rest} value={(form as Record<string, string>)[key]} onChange={e => setForm({ ...form, [key]: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">نوع الخدمة</label>
                <input value={form.serviceType} onChange={e => setForm({ ...form, serviceType: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">التخفيض</label>
                <input value={form.discount} onChange={e => setForm({ ...form, discount: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">المجموعة</label>
              <select value={form.groupId || ""} onChange={e => setForm({ ...form, groupId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]">
                <option value="">بدون مجموعة</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setOpen(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50">إلغاء</button>
              <button onClick={save} className="flex-1 px-4 py-2 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E]">حفظ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
