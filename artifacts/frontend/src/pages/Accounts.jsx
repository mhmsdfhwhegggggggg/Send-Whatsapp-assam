import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Smartphone, Trash2, QrCode, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

const STATUS_MAP = {
  connected: { label: "متصل", color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
  qr: { label: "بانتظار المسح", color: "text-amber-700 bg-amber-50 border-amber-200", icon: QrCode },
  initializing: { label: "جاري التهيئة", color: "text-blue-700 bg-blue-50 border-blue-200", icon: Loader2 },
  disconnected: { label: "غير متصل", color: "text-slate-600 bg-slate-100 border-slate-200", icon: AlertCircle },
  logged_out: { label: "تم تسجيل الخروج", color: "text-red-700 bg-red-50 border-red-200", icon: AlertCircle },
};

export default function Accounts() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [activeId, setActiveId] = useState(null);

  const load = () => api.get("/accounts").then(r => setList(r.data)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, []);

  // QR polling
  useEffect(() => {
    if (!qrOpen || !activeId) return;
    const poll = async () => {
      try {
        const r = await api.get(`/accounts/${activeId}/qr`);
        setQrData(r.data);
        if (r.data.status === "connected") {
          toast.success("تم ربط الحساب بنجاح");
          setQrOpen(false); load();
        }
      } catch {}
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [qrOpen, activeId]);

  const add = async () => {
    if (!label.trim()) return toast.error("اسم الحساب مطلوب");
    try {
      const r = await api.post("/accounts", { label });
      toast.success("تم إنشاء الحساب — امسح رمز QR");
      setOpen(false); setLabel("");
      setActiveId(r.data.id); setQrOpen(true); load();
    } catch { toast.error("فشل الإنشاء"); }
  };

  const showQR = (id) => { setActiveId(id); setQrOpen(true); };

  const del = async (id) => {
    if (!window.confirm("حذف هذا الحساب؟ سيتم تسجيل الخروج من واتساب")) return;
    await api.delete(`/accounts/${id}`); load();
  };

  return (
    <div className="space-y-6" data-testid="accounts-page">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-black">حسابات واتساب</h1>
          <p className="text-sm text-slate-500 mt-1">اربط عدة حسابات لتوزيع حمل الإرسال وتقليل خطر الحظر</p>
        </div>
        <Button onClick={() => setOpen(true)} className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="accounts-add-button">
          <Plus className="w-4 h-4 ms-2" /> ربط حساب جديد
        </Button>
      </header>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.length === 0 && (
          <Card className="p-12 col-span-full text-center border-slate-200">
            <Smartphone className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">لا توجد حسابات مربوطة. اضغط "ربط حساب جديد" وامسح QR Code</p>
          </Card>
        )}
        {list.map(a => {
          const st = STATUS_MAP[a.status] || STATUS_MAP.disconnected;
          const Icon = st.icon;
          return (
            <Card key={a.id} className="p-5 border-slate-200" data-testid={`account-card-${a.id}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#E8F5EE] text-[#1B7A3D] flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <Button size="icon" variant="ghost" onClick={() => del(a.id)} className="text-[#C41E24]"><Trash2 className="w-4 h-4" /></Button>
              </div>
              <h3 className="font-heading font-bold text-lg mb-1">{a.label}</h3>
              {a.phone_number && <p className="text-sm text-slate-500 tabular-nums" dir="ltr">{a.phone_number}</p>}
              <div className="mt-3 flex items-center justify-between">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${st.color}`}>
                  <Icon className="w-3.5 h-3.5" /> {st.label}
                </div>
                {(a.status === "qr" || a.status === "initializing" || a.status === "disconnected") && (
                  <Button size="sm" variant="outline" onClick={() => showQR(a.id)} data-testid={`account-qr-${a.id}`}>
                    <QrCode className="w-3.5 h-3.5 ms-1" /> QR
                  </Button>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-3 flex items-center gap-1">
                <span>اليوم: </span>
                <span className="tabular-nums font-semibold">{a.sent_today || 0}</span>
                <span>رسالة</span>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>ربط حساب واتساب جديد</DialogTitle></DialogHeader>
          <div><Label>اسم تعريفي للحساب</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="مثل: الحساب الرئيسي" className="text-right mt-1" data-testid="account-label-input" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={add} className="bg-[#1B7A3D] hover:bg-[#145D2E]" data-testid="account-create-button">إنشاء وعرض QR</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>امسح رمز QR من واتساب</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center py-4">
            {!qrData?.qr ? (
              <div className="w-72 h-72 flex flex-col items-center justify-center bg-slate-50 rounded-lg gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                <p className="text-sm text-slate-500">جاري التحضير...</p>
              </div>
            ) : (
              <img src={qrData.qr} alt="QR" className="w-72 h-72 border-2 border-slate-200 rounded-lg" data-testid="account-qr-image" />
            )}
            <div className="mt-4 text-sm text-slate-600 leading-relaxed text-right max-w-xs space-y-1">
              <div>1. افتح واتساب على هاتفك</div>
              <div>2. اذهب إلى الإعدادات ← الأجهزة المرتبطة</div>
              <div>3. اضغط "ربط جهاز" وامسح الرمز</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
