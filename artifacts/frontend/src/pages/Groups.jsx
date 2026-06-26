import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, FolderKanban, Trash2, Users } from "lucide-react";

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });

  const load = () => api.get("/groups").then(r => setGroups(r.data));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) return toast.error("الاسم مطلوب");
    await api.post("/groups", form);
    toast.success("تمت إضافة المجموعة");
    setOpen(false); setForm({ name: "", description: "" }); load();
  };

  const del = async (id) => {
    if (!window.confirm("حذف هذه المجموعة؟ سيتم إزالة الانتماء من المستفيدين")) return;
    await api.delete(`/groups/${id}`);
    toast.success("تم الحذف"); load();
  };

  return (
    <div className="space-y-6" data-testid="groups-page">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">المجموعات</h1>
          <p className="text-sm text-slate-500 mt-1">قسّم المستفيدين إلى مجموعات لتسهيل الإرسال المستهدف</p>
        </div>
        <Button onClick={() => setOpen(true)} className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="groups-add-button">
          <Plus className="w-4 h-4 ms-2" /> مجموعة جديدة
        </Button>
      </header>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.length === 0 && (
          <Card className="p-12 col-span-full text-center border-slate-200" data-testid="groups-empty">
            <FolderKanban className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">لا توجد مجموعات. أضف مجموعة لتنظيم المستفيدين</p>
          </Card>
        )}
        {groups.map(g => (
          <Card key={g.id} className="p-5 border-slate-200 hover:shadow-md transition-shadow" data-testid={`group-card-${g.id}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-[#E8F5EE] text-[#1B7A3D] flex items-center justify-center">
                <FolderKanban className="w-5 h-5" />
              </div>
              <Button size="icon" variant="ghost" onClick={() => del(g.id)} className="text-[#C41E24] hover:bg-[#FCE9EA]">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
            <h3 className="font-heading font-bold text-lg mb-1">{g.name}</h3>
            {g.description && <p className="text-sm text-slate-500 mb-3">{g.description}</p>}
            <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 rounded-md px-2 py-1 w-fit">
              <Users className="w-3.5 h-3.5" />
              <span className="tabular-nums">{g.count}</span>
              <span>مستفيد</span>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>مجموعة جديدة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>الاسم *</Label><Input data-testid="group-name-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="text-right mt-1" placeholder="مثل: طلاب جامعة صنعاء" /></div>
            <div><Label>الوصف</Label><Textarea data-testid="group-desc-input" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="text-right mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="group-save-button">حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
