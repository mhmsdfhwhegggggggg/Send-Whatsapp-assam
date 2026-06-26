import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { MessageCircle, Building2, Loader2 } from "lucide-react";

export default function Login() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api.post("/auth/login", { username, password });
      localStorage.setItem("token", r.data.token);
      localStorage.setItem("user", JSON.stringify(r.data.user));
      toast.success("مرحباً بك في النظام");
      nav("/");
    } catch (err) {
      toast.error(err.response?.data?.detail || "خطأ في تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#F4F5F7]" data-testid="login-page">
      {/* Right side: hero */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden bg-gradient-to-bl from-[#1B7A3D] via-[#176734] to-[#0F4A24]">
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: "url('https://images.pexels.com/photos/137618/pexels-photo-137618.jpeg?auto=compress&w=1600')",
          backgroundSize: "cover", backgroundPosition: "center"
        }} />
        <div className="relative z-10 p-12 text-white flex flex-col justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="font-heading text-lg font-bold">المؤسسة الوطنية</div>
              <div className="text-xs text-white/80">للتنمية الشاملة</div>
            </div>
          </div>
          <div>
            <h1 className="font-heading text-5xl font-black leading-tight mb-4">
              نبني الإنسان<br/>لنعمر الأوطان
            </h1>
            <p className="text-white/90 text-lg max-w-md leading-relaxed">
              نظام إرسال الرسائل الجماعية للمستفيدين من الخدمات التعليمية والصحية
            </p>
          </div>
          <div className="flex gap-8 text-sm">
            <div><div className="text-3xl font-bold tabular-nums">١٣٬٧٥٠+</div><div className="text-white/70">مستفيد</div></div>
            <div><div className="text-3xl font-bold tabular-nums">٣٥+</div><div className="text-white/70">جامعة</div></div>
            <div><div className="text-3xl font-bold tabular-nums">١٢</div><div className="text-white/70">سنة عطاء</div></div>
          </div>
        </div>
      </div>

      {/* Left side: form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8 border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-xl bg-[#E8F5EE] flex items-center justify-center">
              <MessageCircle className="w-5 h-5 text-[#1B7A3D]" />
            </div>
            <div>
              <div className="font-heading text-xl font-bold text-slate-900">نظام الإرسال</div>
              <div className="text-xs text-slate-500">لوحة التحكم الإدارية</div>
            </div>
          </div>

          <h2 className="font-heading text-2xl font-bold mb-1">مرحباً بعودتك</h2>
          <p className="text-sm text-slate-500 mb-6">أدخل بياناتك للدخول إلى لوحة التحكم</p>

          <form onSubmit={submit} className="space-y-4" data-testid="login-form">
            <div>
              <Label htmlFor="username">اسم المستخدم</Label>
              <Input id="username" data-testid="login-username-input" value={username}
                onChange={(e) => setUsername(e.target.value)} className="mt-1.5 text-right" required />
            </div>
            <div>
              <Label htmlFor="password">كلمة المرور</Label>
              <Input id="password" data-testid="login-password-input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} className="mt-1.5 text-right" required />
            </div>
            <Button type="submit" disabled={loading} data-testid="login-submit-button"
              className="w-full bg-[#1B7A3D] hover:bg-[#145D2E] h-11 font-semibold">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "تسجيل الدخول"}
            </Button>
            <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 leading-relaxed">
              <strong>حساب تجريبي:</strong> admin / admin123 — يُنصح بتغيير كلمة المرور بعد أول تسجيل دخول
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
