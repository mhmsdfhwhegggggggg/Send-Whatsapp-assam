import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Plus, FolderKanban, Trash2, Users } from "lucide-react";

interface Group { id: string; name: string; description?: string; count: number; }

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  const load = () => api.get("/groups").then(r => setGroups(r.data as Group[]));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) return toast.error("الاسم مطلوب");
    await api.post("/groups", form);
    toast.success("تمت إضافة المجموعة");
    setOpen(false); setForm({ name: "", description: "" }); load();
  };

  const del = async (id: string) => {
    if (!window.confirm("حذف هذه المجموعة؟")) return;
    await api.delete(`/groups/${id}`);
    toast.success("تم الحذف"); load();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">المجموعات</h1>
          <p className="text-sm text-slate-500 mt-1">قسّم المستفيدين إلى مجموعات لتسهيل الإرسال المستهدف</p>
        </div>
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E]">
          <Plus className="w-4 h-4" /> مجموعة جديدة
        </button>
      </header>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 col-span-full text-center">
            <FolderKanban className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">لا توجد مجموعات. أضف مجموعة لتنظيم المستفيدين</p>
          </div>
        )}
        {groups.map(g => (
          <div key={g.id} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-[#E8F5EE] text-[#1B7A3D] flex items-center justify-center">
                <FolderKanban className="w-5 h-5" />
              </div>
              <button onClick={() => del(g.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <h3 className="font-bold text-lg mb-1">{g.name}</h3>
            {g.description && <p className="text-sm text-slate-500 mb-3">{g.description}</p>}
            <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 rounded-md px-2 py-1 w-fit">
              <Users className="w-3.5 h-3.5" />
              <span className="tabular-nums">{g.count}</span>
              <span>مستفيد</span>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm mx-4 space-y-4" dir="rtl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold">مجموعة جديدة</h2>
            <div>
              <label className="block text-sm font-medium mb-1">الاسم *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="مثل: طلاب جامعة صنعاء"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">الوصف</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D] h-24 resize-none" />
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
