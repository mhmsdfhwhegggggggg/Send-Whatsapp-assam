import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Plus, FileText, Trash2, Edit, Variable } from "lucide-react";

interface Template { id: string; name: string; body: string; description?: string; }

export default function Templates() {
  const [list, setList] = useState<Template[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState({ name: "", body: "", description: "" });

  const load = () => api.get("/templates").then(r => setList(r.data as Template[]));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name || !form.body) return toast.error("الحقول مطلوبة");
    if (editing) await api.put(`/templates/${editing.id}`, form);
    else await api.post("/templates", form);
    toast.success("تم الحفظ");
    setOpen(false); setForm({ name: "", body: "", description: "" }); setEditing(null); load();
  };

  const del = async (id: string) => {
    if (!window.confirm("حذف القالب؟")) return;
    await api.delete(`/templates/${id}`); load();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">قوالب الرسائل</h1>
          <p className="text-sm text-slate-500 mt-1">إنشاء قوالب جاهزة مع متغيرات مثل {"{اسم}"} و {"{جامعة}"}</p>
        </div>
        <button onClick={() => { setEditing(null); setForm({ name: "", body: "", description: "" }); setOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E]">
          <Plus className="w-4 h-4" /> قالب جديد
        </button>
      </header>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 items-start text-sm text-amber-900">
        <Variable className="w-5 h-5 mt-0.5 shrink-0 text-amber-700" />
        <div>
          <strong>المتغيرات:</strong>
          {["{اسم}", "{جامعة}", "{تخفيض}", "{خدمة}"].map(v => (
            <code key={v} className="bg-white px-1.5 py-0.5 rounded mx-1">{v}</code>
          ))}
          <div className="mt-1.5"><strong>Spintax:</strong> <code className="bg-white px-1.5 py-0.5 rounded">{"{مرحباً|أهلاً}"}</code> لتنويع النصوص تلقائياً</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {list.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 col-span-full text-center">
            <FileText className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">لا توجد قوالب بعد</p>
          </div>
        )}
        {list.map(t => (
          <div key={t.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-bold text-lg">{t.name}</h3>
                {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setEditing(t); setForm(t); setOpen(true); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-600"><Edit className="w-4 h-4" /></button>
                <button onClick={() => del(t.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto font-mono">{t.body}</div>
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl mx-4 space-y-4" dir="rtl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold">{editing ? "تعديل قالب" : "قالب رسالة جديد"}</h2>
            <div>
              <label className="block text-sm font-medium mb-1">اسم القالب *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">الوصف</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">نص الرسالة *</label>
              <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D] h-48 resize-none font-mono"
                placeholder={"مرحباً {اسم}،\nنسعد بإبلاغك بحصولك على تخفيض {تخفيض} على رسوم {جامعة}..."} />
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
