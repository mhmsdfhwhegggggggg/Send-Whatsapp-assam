import { useEffect, useState, useRef } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  Plus, Smartphone, Trash2, QrCode, CheckCircle2,
  AlertCircle, Loader2, RefreshCw, WifiOff, Shield, Flame, Sprout, Sparkles,
} from "lucide-react";

interface Account {
  id: string;
  label: string;
  phoneNumber?: string;
  proxy?: string;
  status: string;
  sentToday: number;
  warmUpDay: number;
  warmUpTier: "new" | "warm" | "hot";
  totalReplies: number;
  totalSent: number;
}
interface QrData { qr?: string; status: string; }

const STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  connected:    { label: "متصل",             color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: "check" },
  qr:           { label: "انتظر المسح",      color: "text-blue-700 bg-blue-50 border-blue-200",         icon: "qr"    },
  initializing: { label: "جاري التهيئة...",  color: "text-amber-700 bg-amber-50 border-amber-200",      icon: "spin"  },
  error:        { label: "خطأ في التهيئة",   color: "text-red-700 bg-red-50 border-red-200",            icon: "err"   },
  disconnected: { label: "غير متصل",         color: "text-slate-600 bg-slate-100 border-slate-200",     icon: "off"   },
  logged_out:   { label: "تم تسجيل الخروج", color: "text-red-700 bg-red-50 border-red-200",            icon: "err"   },
};

const TIER_MAP = {
  new:  { label: "🆕 جديد",  color: "text-blue-700 bg-blue-50 border-blue-200" },
  warm: { label: "🌱 دافئ",  color: "text-amber-700 bg-amber-50 border-amber-200" },
  hot:  { label: "🔥 ساخن",  color: "text-red-700 bg-red-50 border-red-200" },
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

function TierBadge({ tier }: { tier: "new" | "warm" | "hot" }) {
  const t = TIER_MAP[tier] ?? TIER_MAP.new;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${t.color}`}>
      {t.label}
    </span>
  );
}

export default function Accounts() {
  const [list, setList]         = useState<Account[]>([]);
  const [open, setOpen]         = useState(false);
  const [label, setLabel]       = useState("");
  const [proxy, setProxy]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [qrOpen, setQrOpen]     = useState(false);
  const [qrData, setQrData]     = useState<QrData | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initSec, setInitSec]   = useState(0);
  const timerRef                = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () =>
    api.get("/accounts").then((r) => setList(r.data as Account[])).catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  /* QR polling */
  useEffect(() => {
    if (!qrOpen || !activeId) return;
    setInitSec(0);
    const ticker = setInterval(() => setInitSec((s) => s + 1), 1000);
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
      const r = await api.post("/accounts", {
        label,
        proxy: proxy.trim() || undefined,
      });
      toast.success("تم إنشاء الحساب — جاري تحضير رمز QR (30-60 ثانية)");
      setOpen(false);
      setLabel("");
      setProxy("");
      setActiveId((r.data as Account).id);
      setQrData(null);
      setQrOpen(true);
      load();
    } catch {
      toast.error("فشل الإنشاء");
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (!window.confirm("حذف هذا الحساب وقطع اتصاله؟")) return;
    await api.delete(`/accounts/${id}`);
    load();
  };

  const openQr = (id: string) => {
    setActiveId(id);
    setQrData(null);
    setQrOpen(true);
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">حسابات واتساب</h1>
          <p className="text-sm text-slate-500 mt-1">
            كل حساب يحتاج Proxy مختلف لتجنب الحظر
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1B7A3D] text-white font-medium hover:bg-[#145D2E] transition-colors text-sm"
        >
          <Plus className="w-4 h-4" /> إضافة حساب
        </button>
      </div>

      {/* Proxy warning banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
        <Shield className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="text-sm text-amber-800">
          <strong>تحذير مهم:</strong> كل حساب يجب أن يستخدم Proxy مختلف (residential proxy).
          استخدام نفس IP لعدة حسابات يؤدي للحظر الفوري. بدون Proxy، الحسابات معرضة للحظر.
        </div>
      </div>

      {/* Account cards */}
      <div className="grid gap-4">
        {list.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Smartphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا توجد حسابات بعد. أضف أول حساب.</p>
          </div>
        )}
        {list.map((a) => (
          <div
            key={a.id}
            className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-full bg-[#1B7A3D]/10 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5 text-[#1B7A3D]" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{a.label}</span>
                <StatusBadge status={a.status} />
                <TierBadge tier={a.warmUpTier ?? "new"} />
              </div>
              <div className="flex items-center gap-4 mt-1.5 text-xs text-slate-500 flex-wrap">
                {a.phoneNumber && <span dir="ltr">{a.phoneNumber}</span>}
                <span>يوم التدرج: {a.warmUpDay}</span>
                <span>مُرسَل اليوم: {a.sentToday}</span>
                <span>ردود: {a.totalReplies}</span>
                <span>إجمالي: {a.totalSent}</span>
                {a.proxy
                  ? <span className="text-emerald-600 font-medium">✓ Proxy مُفعَّل</span>
                  : <span className="text-red-500 font-medium">⚠ بدون Proxy</span>}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => openQr(a.id)}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
                title="عرض QR"
              >
                <QrCode className="w-4 h-4" />
              </button>
              <button
                onClick={() => del(a.id)}
                className="p-2 rounded-lg border border-red-100 hover:bg-red-50 text-red-500 transition-colors"
                title="حذف"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add account modal */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold">إضافة حساب واتساب جديد</h2>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">اسم الحساب *</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D]"
                placeholder="مثال: حساب فيصل"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Proxy (مُوصى به بشدة)
              </label>
              <input
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                dir="ltr"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-left text-sm focus:outline-none focus:ring-2 focus:ring-[#1B7A3D] font-mono"
                placeholder="http://user:pass@host:port"
              />
              <p className="text-xs text-amber-700 mt-1.5 bg-amber-50 px-2 py-1.5 rounded">
                ⚠ كل حساب يجب أن يمتلك Proxy residential مختلف.
                بدون Proxy، الحساب سيُشارك IP الخادم مع بقية الحسابات وسيُحظر.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                onClick={add}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-lg bg-[#1B7A3D] text-white text-sm font-medium hover:bg-[#145D2E] disabled:opacity-50 transition-colors"
              >
                {saving ? "جاري الإنشاء..." : "إنشاء الحساب"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR modal */}
      {qrOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setQrOpen(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold">مسح رمز QR</h2>

            {(!qrData || qrData.status === "initializing") && (
              <div className="py-10 space-y-3">
                <Loader2 className="w-12 h-12 text-[#1B7A3D] animate-spin mx-auto" />
                <p className="text-sm text-slate-500">جاري تهيئة Puppeteer + Stealth...</p>
                <p className="text-xs text-slate-400">{initSec}s — قد يستغرق 30–60 ثانية</p>
              </div>
            )}

            {qrData?.status === "qr" && qrData.qr && (
              <div className="space-y-3">
                <img src={qrData.qr} alt="QR" className="w-56 h-56 mx-auto rounded-lg border border-slate-200" />
                <p className="text-sm text-slate-600">
                  افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز ← امسح الرمز
                </p>
                <div className="flex items-center justify-center gap-1.5 text-xs text-blue-600">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  تحديث تلقائي...
                </div>
              </div>
            )}

            {qrData?.status === "connected" && (
              <div className="py-6 space-y-2">
                <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto" />
                <p className="font-semibold text-emerald-700">تم الربط بنجاح!</p>
              </div>
            )}

            {qrData?.status === "error" && (
              <div className="py-6 space-y-2">
                <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
                <p className="text-sm text-red-600">فشل في التهيئة. تحقق من إعداد Chromium.</p>
              </div>
            )}

            <button
              onClick={() => setQrOpen(false)}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 text-sm hover:bg-slate-50"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
