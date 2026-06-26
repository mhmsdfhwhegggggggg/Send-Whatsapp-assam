import { useEffect, useState, useRef } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  Plus, Smartphone, Trash2, QrCode, CheckCircle2,
  AlertCircle, Loader2, RefreshCw, WifiOff,
} from "lucide-react";

interface Account {
  id: string; label: string; phoneNumber?: string; status: string; sentToday: number;
}
interface QrData { qr?: string; status: string; }

const STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  connected:    { label: "متصل",               color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: "check" },
  qr:           { label: "انتظر المسح",        color: "text-blue-700 bg-blue-50 border-blue-200",         icon: "qr" },
  initializing: { label: "جاري التهيئة...",    color: "text-amber-700 bg-amber-50 border-amber-200",      icon: "spin" },
  error:        { label: "خطأ في التهيئة",     color: "text-red-700 bg-red-50 border-red-200",            icon: "err" },
  disconnected: { label: "غير متصل",           color: "text-slate-600 bg-slate-100 border-slate-200",     icon: "off" },
  logged_out:   { label: "تم تسجيل الخروج",   color: "text-red-700 bg-red-50 border-red-200",            icon: "err" },
};

function StatusBadge({ status }: { status: string }) {
  const st = STATUS_MAP[status] ?? STATUS_MAP.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${st.color}`}>
      {st.icon === "check" && <CheckCircle2 className="w-3.5 h-3.5" />}
      {st.icon === "spin"  && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {st.icon === "qr"   && <QrCode className="w-3.5 h-3.5" />}
      {st.icon === "err"  && <AlertCircle className="w-3.5 h-3.5" />}
      {st.icon === "off"  && <WifiOff className="w-3.5 h-3.5" />}
      {st.label}
    </span>
  );
}

export default function Accounts() {
  const [list, setList]           = useState<Account[]>([]);
  const [open, setOpen]           = useState(false);
  const [label, setLabel]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [qrOpen, setQrOpen]       = useState(false);
  const [qrData, setQrData]       = useState<QrData | null>(null);
  const [activeId, setActiveId]   = useState<string | null>(null);
  const [initSec, setInitSec]     = useState(0);
  const timerRef                  = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () =>
    api.get("/accounts").then(r => setList(r.data as Account[])).catch(() => {});

  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);

  /* QR polling */
  useEffect(() => {
    if (!qrOpen || !activeId) return;

    setInitSec(0);
    const ticker = setInterval(() => setInitSec(s => s + 1), 1000);
    timerRef.current = ticker;

    const poll = setInterval(async () => {
      try {
        const r = await api.get(`/accounts/${activeId}/qr`);
        const d = r.data as QrData;
        setQrData(d);
        if (d.status === "connected") {
          toast.success("✅ تم ربط الحساب بنجاح!");
          setQrOpen(false);
          load();
        }
      } catch {}
    }, 1500);

    return () => { clearInterval(ticker); clearInterval(poll); };
  }, [qrOpen, activeId]);

  const add = async () => {
    if (!label.trim()) return toast.error("اسم الحساب مطلوب");
    setSaving(true);
    try {
      const r = await api.post("/accounts", { label });
      toast.success("تم إنشاء الحساب — جاري تحضير رمز QR (30-60 ثانية)");
      setOpen(false); setLabel("");
      setActiveId((r.data as Account).id);
      setQrData(null);
      setQrOpen(true);
      load();
    } catch { toast.error("فشل الإنشاء"); }
    finally { setSaving(false); }
  };

  const del = async (id: string) => {
    if (!window.confirm("حذف هذا الحساب وقطع اتصاله؟")) return;
    await api.delete(`/accounts/${id}`); load();
  };

  const showQr = (id: string) => {
    setActiveId(id); setQrData(null); setQrOpen(true);
  };

  /* Estimated time display */
  const estimatedTotal = 45;
  const pct = Math.min((initSec / estimatedTotal) * 100, 95);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">حسابات واتساب</h1>
          <p className="text-sm text-slate-500 mt-1">
            اربط عدة حسابات لتوزيع حمل الإرسال — كل حساب يحتاج 30-60 ثانية للتهيئة
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E] transition-colors"
        >
          <Plus className="w-4 h-4" /> ربط حساب جديد
        </button>
      </header>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 flex gap-3">
        <Loader2 className="w-5 h-5 shrink-0 mt-0.5 text-blue-600" />
        <div>
          <strong>كيفية ربط الحساب:</strong> اضغط "ربط حساب جديد" ← انتظر 30-60 ثانية حتى يظهر رمز QR ← افتح
          واتساب على هاتفك ← الإعدادات ← الأجهزة المرتبطة ← ربط جهاز ← امسح الرمز
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 col-span-full text-center">
            <Smartphone className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">لا توجد حسابات مربوطة</p>
            <p className="text-slate-400 text-sm mt-1">اضغط "ربط حساب جديد" للبدء</p>
          </div>
        )}
        {list.map(a => (
          <div key={a.id} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-[#E8F5EE] text-[#1B7A3D] flex items-center justify-center">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="flex gap-1">
                {a.status !== "connected" && (
                  <button
                    onClick={() => showQr(a.id)}
                    title="عرض QR"
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-600"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => del(a.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <h3 className="font-bold text-lg mb-0.5">{a.label}</h3>
            {a.phoneNumber && (
              <p className="text-sm text-slate-500 tabular-nums mb-2" dir="ltr">{a.phoneNumber}</p>
            )}

            <div className="flex items-center justify-between mt-3">
              <StatusBadge status={a.status} />
              <span className="text-xs text-slate-400">
                اليوم: <span className="font-semibold tabular-nums text-slate-600">{a.sentToday ?? 0}</span>
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Add Account Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-sm mx-4 space-y-4"
            dir="rtl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold">ربط حساب واتساب جديد</h2>
            <div>
              <label className="block text-sm font-medium mb-1">اسم تعريفي للحساب</label>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                onKeyDown={e => e.key === "Enter" && add()}
                placeholder="مثل: الحساب الرئيسي"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]"
                autoFocus
              />
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              ⏳ بعد الإنشاء، انتظر <strong>30-60 ثانية</strong> حتى يظهر رمز QR تلقائياً
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                onClick={add}
                disabled={saving}
                className="flex-1 px-4 py-2 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> جاري الإنشاء...</> : "إنشاء وعرض QR"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Modal */}
      {qrOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setQrOpen(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl"
            dir="rtl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-1 text-center">امسح رمز QR</h2>
            <p className="text-sm text-slate-500 text-center mb-5">
              من تطبيق واتساب ← الإعدادات ← الأجهزة المرتبطة
            </p>

            <div className="flex flex-col items-center">
              {!qrData?.qr ? (
                <div className="w-64 h-64 flex flex-col items-center justify-center bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-[#1B7A3D]" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-700">جاري تهيئة المتصفح...</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {initSec}ث مضت — المتوقع ~{estimatedTotal}ث
                    </p>
                  </div>
                  {/* Progress bar */}
                  <div className="w-48 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#1B7A3D] rounded-full transition-all duration-1000"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <img
                    src={qrData.qr}
                    alt="QR Code"
                    className="w-64 h-64 border-4 border-[#1B7A3D] rounded-xl"
                  />
                  <div className="absolute -top-2 -right-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                    جاهز للمسح
                  </div>
                </div>
              )}

              <div className="mt-5 w-full space-y-2 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#1B7A3D] text-white text-xs flex items-center justify-center font-bold shrink-0">١</span>
                  افتح واتساب على هاتفك
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#1B7A3D] text-white text-xs flex items-center justify-center font-bold shrink-0">٢</span>
                  الإعدادات → الأجهزة المرتبطة
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#1B7A3D] text-white text-xs flex items-center justify-center font-bold shrink-0">٣</span>
                  اضغط "ربط جهاز" وامسح الرمز
                </div>
              </div>
            </div>

            <button
              onClick={() => setQrOpen(false)}
              className="mt-5 w-full px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
            >
              إغلاق (الحساب سيظل قيد التهيئة)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
