import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, FileText, Trash2, Edit, Variable } from "lucide-react";

export default function Templates() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", body: "", description: "" });

  const load = () => api.get("/templates").then(r => setList(r.data));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name || !form.body) return toast.error("الحقول مطلوبة");
    if (editing) await api.put(`/templates/${editing.id}`, form);
    else await api.post("/templates", form);
    toast.success("تم الحفظ"); setOpen(false); setForm({ name: "", body: "", description: "" }); setEditing(null); load();
  };
  const del = async (id) => {
    if (!window.confirm("حذف القالب؟")) return;
    await api.delete(`/templates/${id}`); load();
  };
  const edit = (t) => { setEditing(t); setForm(t); setOpen(true); };

  return (
    <div className="space-y-6" data-testid="templates-page">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">قوالب الرسائل</h1>
          <p className="text-sm text-slate-500 mt-1">إنشاء قوالب جاهزة مع متغيرات مثل {"{اسم}"} و {"{جامعة}"}</p>
        </div>
        <Button onClick={() => { setEditing(null); setForm({ name: "", body: "", description: "" }); setOpen(true); }}
          className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="templates-add-button">
          <Plus className="w-4 h-4 ms-2" /> قالب جديد
        </Button>
      </header>

      <Card className="p-4 border-amber-200 bg-amber-50">
        <div className="flex gap-3 items-start">
          <Variable className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-900">
            <strong>المتغيرات المتاحة:</strong> <code className="bg-white px-1.5 py-0.5 rounded mx-1">{"{اسم}"}</code>
            <code className="bg-white px-1.5 py-0.5 rounded mx-1">{"{جامعة}"}</code>
            <code className="bg-white px-1.5 py-0.5 rounded mx-1">{"{تخفيض}"}</code>
            <code className="bg-white px-1.5 py-0.5 rounded mx-1">{"{خدمة}"}</code>
            <div className="mt-2"><strong>Spintax:</strong> استخدم <code className="bg-white px-1.5 py-0.5 rounded">{"{مرحباً|أهلاً}"}</code> لتنويع النصوص تلقائياً وتفادي الكشف.</div>
          </div>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {list.length === 0 && (
          <Card className="p-12 col-span-full text-center border-slate-200">
            <FileText className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">لا توجد قوالب بعد</p>
          </Card>
        )}
        {list.map(t => (
          <Card key={t.id} className="p-5 border-slate-200" data-testid={`template-card-${t.id}`}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-heading font-bold text-lg">{t.name}</h3>
                {t.description && <p className="text-xs text-slate-500">{t.description}</p>}
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => edit(t)}><Edit className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => del(t.id)} className="text-[#C41E24]"><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
              {t.body}
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "تعديل قالب" : "قالب رسالة جديد"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم القالب *</Label><Input data-testid="template-name-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="text-right mt-1" /></div>
            <div><Label>الوصف</Label><Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="text-right mt-1" /></div>
            <div><Label>نص الرسالة *</Label>
              <Textarea data-testid="template-body-input" value={form.body} onChange={e => setForm({...form, body: e.target.value})}
                className="text-right mt-1 min-h-[180px] font-mono text-sm" placeholder="مرحباً {اسم}،&#10;نسعد بإبلاغك بحصولك على تخفيض {تخفيض} على رسوم {جامعة}..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="template-save-button">حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
