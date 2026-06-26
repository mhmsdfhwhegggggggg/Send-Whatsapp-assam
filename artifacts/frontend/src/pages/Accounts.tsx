import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Plus, Smartphone, Trash2, QrCode, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface Account { id: string; label: string; phoneNumber?: string; status: string; sentToday: number; }
interface QrData { qr?: string; status: string; }

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  connected: { label: "متصل", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  qr: { label: "بانتظار المسح", color: "text-amber-700 bg-amber-50 border-amber-200" },
  initializing: { label: "جاري التهيئة", color: "text-blue-700 bg-blue-50 border-blue-200" },
  disconnected: { label: "غير متصل", color: "text-slate-600 bg-slate-100 border-slate-200" },
  logged_out: { label: "تم تسجيل الخروج", color: "text-red-700 bg-red-50 border-red-200" },
};

export default function Accounts() {
  const [list, setList] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState<QrData | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = () => api.get("/accounts").then(r => setList(r.data as Account[])).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!qrOpen || !activeId) return;
    const poll = async () => {
      try {
        const r = await api.get(`/accounts/${activeId}/qr`);
        const d = r.data as QrData;
        setQrData(d);
        if (d.status === "connected") { toast.success("تم ربط الحساب بنجاح"); setQrOpen(false); load(); }
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
      setActiveId((r.data as Account).id); setQrOpen(true); load();
    } catch { toast.error("فشل الإنشاء"); }
  };

  const del = async (id: string) => {
    if (!window.confirm("حذف هذا الحساب؟")) return;
    await api.delete(`/accounts/${id}`); load();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">حسابات واتساب</h1>
          <p className="text-sm text-slate-500 mt-1">اربط عدة حسابات لتوزيع حمل الإرسال وتقليل خطر الحظر</p>
        </div>
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E]">
          <Plus className="w-4 h-4" /> ربط حساب جديد
        </button>
      </header>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 col-span-full text-center">
            <Smartphone className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500">لا توجد حسابات مربوطة. اضغط "ربط حساب جديد" وامسح QR Code</p>
          </div>
        )}
        {list.map(a => {
          const st = STATUS_MAP[a.status] ?? STATUS_MAP.disconnected;
          return (
            <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-[#E8F5EE] text-[#1B7A3D] flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <button onClick={() => del(a.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
              <h3 className="font-bold text-lg mb-1">{a.label}</h3>
              {a.phoneNumber && <p className="text-sm text-slate-500 tabular-nums" dir="ltr">{a.phoneNumber}</p>}
              <div className="mt-3 flex items-center justify-between">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${st.color}`}>
                  {a.status === "connected" ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                   a.status === "initializing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
                   <AlertCircle className="w-3.5 h-3.5" />}
                  {st.label}
                </span>
                {a.status !== "connected" && (
                  <button onClick={() => { setActiveId(a.id); setQrOpen(true); }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 text-xs hover:bg-slate-50">
                    <QrCode className="w-3.5 h-3.5" /> QR
                  </button>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-3">اليوم: <span className="font-semibold tabular-nums">{a.sentToday ?? 0}</span> رسالة</div>
            </div>
          );
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm mx-4 space-y-4" dir="rtl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold">ربط حساب واتساب جديد</h2>
            <div>
              <label className="block text-sm font-medium mb-1">اسم تعريفي للحساب</label>
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="مثل: الحساب الرئيسي"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50">إلغاء</button>
              <button onClick={add} className="flex-1 px-4 py-2 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E]">إنشاء وعرض QR</button>
            </div>
          </div>
        </div>
      )}

      {qrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setQrOpen(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm mx-4" dir="rtl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">امسح رمز QR من واتساب</h2>
            <div className="flex flex-col items-center py-4">
              {!qrData?.qr ? (
                <div className="w-64 h-64 flex flex-col items-center justify-center bg-slate-50 rounded-lg gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                  <p className="text-sm text-slate-500">جاري التحضير...</p>
                </div>
              ) : (
                <img src={qrData.qr} alt="QR" className="w-64 h-64 border-2 border-slate-200 rounded-lg" />
              )}
              <div className="mt-4 text-sm text-slate-600 leading-relaxed space-y-1">
                <div>١. افتح واتساب على هاتفك</div>
                <div>٢. اذهب إلى الإعدادات ← الأجهزة المرتبطة</div>
                <div>٣. اضغط "ربط جهاز" وامسح الرمز</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
