import { useEffect, useState, useRef } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Upload, Search, Trash2, Edit, Users } from "lucide-react";

export default function Students() {
  const [students, setStudents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [q, setQ] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", university: "", service_type: "", discount: "", group_id: "" });
  const fileRef = useRef();

  const load = async () => {
    const params = {};
    if (groupFilter !== "all") params.group_id = groupFilter;
    if (q) params.q = q;
    const r = await api.get("/students", { params });
    setStudents(r.data);
  };
  useEffect(() => { api.get("/groups").then(r => setGroups(r.data)); }, []);
  useEffect(() => { load(); }, [groupFilter]);

  const search = (e) => { e.preventDefault(); load(); };

  const openAdd = () => { setEditing(null); setForm({ name: "", phone: "", university: "", service_type: "", discount: "", group_id: "" }); setOpen(true); };
  const openEdit = (s) => { setEditing(s); setForm({ ...s, group_id: s.group_id || "" }); setOpen(true); };

  const save = async () => {
    try {
      const data = { ...form, group_id: form.group_id || null };
      if (editing) await api.put(`/students/${editing.id}`, data);
      else await api.post("/students", data);
      toast.success(editing ? "تم التحديث" : "تمت الإضافة");
      setOpen(false); load();
    } catch (e) { toast.error("فشل الحفظ"); }
  };

  const del = async (id) => {
    if (!window.confirm("حذف هذا المستفيد؟")) return;
    await api.delete(`/students/${id}`);
    toast.success("تم الحذف"); load();
  };

  const importCsv = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try {
      const r = await api.post("/students/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`تم استيراد ${r.data.imported} مستفيد`);
      load();
    } catch { toast.error("فشل الاستيراد"); }
    e.target.value = "";
  };

  return (
    <div className="space-y-6" data-testid="students-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-black text-slate-900">المستفيدون</h1>
          <p className="text-sm text-slate-500 mt-1">إدارة قاعدة بيانات الطلاب والمستفيدين من خدمات المؤسسة</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" hidden onChange={importCsv} data-testid="students-import-input" />
          <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="students-import-button">
            <Upload className="w-4 h-4 ms-2" /> استيراد CSV
          </Button>
          <Button onClick={openAdd} className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="students-add-button">
            <Plus className="w-4 h-4 ms-2" /> إضافة مستفيد
          </Button>
        </div>
      </header>

      <Card className="p-4 border-slate-200">
        <form onSubmit={search} className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input data-testid="students-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم أو الهاتف" className="ps-3 pe-9 text-right" />
          </div>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-48" data-testid="students-group-filter"><SelectValue placeholder="الكل" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المجموعات</SelectItem>
              {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline">بحث</Button>
        </form>
      </Card>

      <Card className="border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-right">
            <tr>
              <th className="px-4 py-3 font-semibold">الاسم</th>
              <th className="px-4 py-3 font-semibold">الهاتف</th>
              <th className="px-4 py-3 font-semibold">الجامعة</th>
              <th className="px-4 py-3 font-semibold">الخدمة</th>
              <th className="px-4 py-3 font-semibold">التخفيض</th>
              <th className="px-4 py-3 font-semibold w-24">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100" data-testid="students-table">
            {students.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16 text-slate-400">
                <Users className="w-12 h-12 mx-auto mb-2 opacity-40" />
                لا يوجد مستفيدون بعد. ابدأ بالإضافة أو الاستيراد من ملف CSV
              </td></tr>
            )}
            {students.map(s => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{s.name}</td>
                <td className="px-4 py-3 tabular-nums text-slate-700" dir="ltr">{s.phone}</td>
                <td className="px-4 py-3 text-slate-600">{s.university || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{s.service_type || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{s.discount || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(s)} data-testid={`student-edit-${s.id}`}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => del(s.id)} className="text-[#C41E24] hover:bg-[#FCE9EA]" data-testid={`student-delete-${s.id}`}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader><DialogTitle>{editing ? "تعديل مستفيد" : "إضافة مستفيد جديد"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>الاسم *</Label><Input data-testid="student-name-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="text-right mt-1" /></div>
            <div><Label>رقم الهاتف *</Label><Input data-testid="student-phone-input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="967xxxxxxxxx" dir="ltr" className="mt-1" /></div>
            <div><Label>الجامعة</Label><Input data-testid="student-university-input" value={form.university} onChange={e => setForm({...form, university: e.target.value})} className="text-right mt-1" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>نوع الخدمة</Label><Input value={form.service_type} onChange={e => setForm({...form, service_type: e.target.value})} className="text-right mt-1" /></div>
              <div><Label>التخفيض</Label><Input value={form.discount} onChange={e => setForm({...form, discount: e.target.value})} className="text-right mt-1" /></div>
            </div>
            <div><Label>المجموعة</Label>
              <Select value={form.group_id || "none"} onValueChange={v => setForm({...form, group_id: v === "none" ? "" : v})}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون مجموعة</SelectItem>
                  {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="student-save-button">حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
