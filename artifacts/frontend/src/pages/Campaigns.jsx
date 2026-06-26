import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Send, Play, Pause, Trash2, ChevronLeft } from "lucide-react";

const statusBadge = (s) => {
  const map = {
    running: ["bg-emerald-50 text-emerald-700 border-emerald-200", "قيد التشغيل"],
    completed: ["bg-blue-50 text-blue-700 border-blue-200", "مكتملة"],
    paused: ["bg-amber-50 text-amber-700 border-amber-200", "متوقفة مؤقتاً"],
    pending: ["bg-slate-100 text-slate-600 border-slate-200", "بانتظار البدء"],
  };
  const [cls, label] = map[s] || map.pending;
  return <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${cls}`}>{label}</span>;
};

export default function Campaigns() {
  const [list, setList] = useState([]);
  const [groups, setGroups] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const [form, setForm] = useState({
    name: "", template_id: "", group_ids: [], account_ids: [],
    min_delay_sec: 5, max_delay_sec: 25, batch_size: 50, batch_pause_min: 5,
  });

  const load = () => api.get("/campaigns").then(r => setList(r.data));
  useEffect(() => {
    load();
    api.get("/groups").then(r => setGroups(r.data));
    api.get("/templates").then(r => setTemplates(r.data));
    api.get("/accounts").then(r => setAccounts(r.data));
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const toggle = (key, id) => {
    setForm(f => ({ ...f, [key]: f[key].includes(id) ? f[key].filter(x => x !== id) : [...f[key], id] }));
  };

  const create = async () => {
    if (!form.name || !form.template_id || form.account_ids.length === 0 || form.group_ids.length === 0) {
      return toast.error("املأ جميع الحقول واختر مجموعة وحساباً");
    }
    try {
      const r = await api.post("/campaigns", form);
      toast.success("تم إنشاء الحملة وبدأ الإرسال");
      setOpen(false); load();
      nav(`/campaigns/${r.data.id}`);
    } catch (e) { toast.error(e.response?.data?.detail || "فشل الإنشاء"); }
  };

  const pause = async (id) => { await api.post(`/campaigns/${id}/pause`); load(); };
  const start = async (id) => { await api.post(`/campaigns/${id}/start`); load(); };
  const del = async (id) => { if (window.confirm("حذف الحملة وجميع رسائلها؟")) { await api.delete(`/campaigns/${id}`); load(); } };

  return (
    <div className="space-y-6" data-testid="campaigns-page">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">الحملات</h1>
          <p className="text-sm text-slate-500 mt-1">إنشاء وإدارة حملات الإرسال الجماعي</p>
        </div>
        <Button onClick={() => setOpen(true)} className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="campaigns-add-button">
          <Plus className="w-4 h-4 ms-2" /> حملة جديدة
        </Button>
      </header>

      <Card className="border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-right">
            <tr>
              <th className="px-4 py-3 font-semibold">اسم الحملة</th>
              <th className="px-4 py-3 font-semibold">الحالة</th>
              <th className="px-4 py-3 font-semibold">التقدم</th>
              <th className="px-4 py-3 font-semibold">الإرسال</th>
              <th className="px-4 py-3 font-semibold w-32">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100" data-testid="campaigns-table">
            {list.length === 0 && <tr><td colSpan={5} className="text-center py-16 text-slate-400">
              <Send className="w-12 h-12 mx-auto mb-2 opacity-40" />لا توجد حملات بعد
            </td></tr>}
            {list.map(c => {
              const pct = c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0;
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/campaigns/${c.id}`} className="text-slate-900 hover:text-[#1B7A3D]">{c.name}</Link>
                  </td>
                  <td className="px-4 py-3">{statusBadge(c.status)}</td>
                  <td className="px-4 py-3 w-72">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#1B7A3D]" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs tabular-nums font-medium text-slate-700">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-xs text-slate-600">
                    <span className="text-emerald-700">{c.sent || 0}</span> / {c.total || 0}
                    {c.failed > 0 && <span className="text-red-600 ms-2">({c.failed} فشل)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {c.status === "running"
                        ? <Button size="icon" variant="ghost" onClick={() => pause(c.id)}><Pause className="w-4 h-4" /></Button>
                        : c.status !== "completed" && <Button size="icon" variant="ghost" onClick={() => start(c.id)}><Play className="w-4 h-4 text-[#1B7A3D]" /></Button>}
                      <Button size="icon" variant="ghost" onClick={() => del(c.id)} className="text-[#C41E24]"><Trash2 className="w-4 h-4" /></Button>
                      <Link to={`/campaigns/${c.id}`}><Button size="icon" variant="ghost"><ChevronLeft className="w-4 h-4" /></Button></Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>حملة إرسال جديدة</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>اسم الحملة *</Label><Input data-testid="campaign-name-input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="text-right mt-1" /></div>
            <div><Label>قالب الرسالة *</Label>
              <Select value={form.template_id} onValueChange={v => setForm({...form, template_id: v})}>
                <SelectTrigger data-testid="campaign-template-select" className="mt-1"><SelectValue placeholder="اختر قالباً" /></SelectTrigger>
                <SelectContent>{templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>المجموعات المستهدفة *</Label>
              <div className="border rounded-lg p-3 mt-1 space-y-2 max-h-40 overflow-y-auto" data-testid="campaign-groups-list">
                {groups.length === 0 && <p className="text-xs text-slate-400">لا توجد مجموعات</p>}
                {groups.map(g => (
                  <label key={g.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <Checkbox checked={form.group_ids.includes(g.id)} onCheckedChange={() => toggle("group_ids", g.id)} />
                    <span className="text-sm">{g.name}</span>
                    <span className="text-xs text-slate-400 mr-auto tabular-nums">{g.count} مستفيد</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>حسابات الإرسال *</Label>
              <div className="border rounded-lg p-3 mt-1 space-y-2 max-h-40 overflow-y-auto" data-testid="campaign-accounts-list">
                {accounts.length === 0 && <p className="text-xs text-slate-400">لا توجد حسابات. اربط حساباً أولاً</p>}
                {accounts.map(a => (
                  <label key={a.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <Checkbox checked={form.account_ids.includes(a.id)} onCheckedChange={() => toggle("account_ids", a.id)} />
                    <span className="text-sm">{a.label}</span>
                    <span className={`text-xs mr-auto px-2 py-0.5 rounded ${a.status === "connected" ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"}`}>
                      {a.status === "connected" ? "متصل" : "غير متصل"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">أدنى تأخير (ث)</Label><Input type="number" value={form.min_delay_sec} onChange={e => setForm({...form, min_delay_sec: +e.target.value})} className="text-right mt-1" /></div>
              <div><Label className="text-xs">أقصى تأخير (ث)</Label><Input type="number" value={form.max_delay_sec} onChange={e => setForm({...form, max_delay_sec: +e.target.value})} className="text-right mt-1" /></div>
              <div><Label className="text-xs">حجم الدفعة</Label><Input type="number" value={form.batch_size} onChange={e => setForm({...form, batch_size: +e.target.value})} className="text-right mt-1" /></div>
              <div><Label className="text-xs">راحة بعد الدفعة (د)</Label><Input type="number" value={form.batch_pause_min} onChange={e => setForm({...form, batch_pause_min: +e.target.value})} className="text-right mt-1" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={create} className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="campaign-create-button">إنشاء وبدء الإرسال</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
