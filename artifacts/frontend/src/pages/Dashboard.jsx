import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Users, Send, Smartphone, FolderKanban, CheckCircle2, AlertCircle, Clock, FileText } from "lucide-react";

const StatCard = ({ icon: Icon, label, value, color, bg, testid }) => (
  <Card className="p-5 border-slate-200" data-testid={testid}>
    <div className="flex items-start justify-between">
      <div>
        <div className="text-sm text-slate-500 font-medium">{label}</div>
        <div className="font-heading text-3xl font-black mt-1 tabular-nums" style={{color}}>{value?.toLocaleString("ar-EG") ?? "—"}</div>
      </div>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{background: bg, color}}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
  </Card>
);

export default function Dashboard() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const load = () => api.get("/stats").then(r => setStats(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <header>
        <h1 className="font-heading text-3xl font-black text-slate-900">لوحة التحكم</h1>
        <p className="text-sm text-slate-500 mt-1">نظرة عامة على أداء النظام والحملات</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Users} label="إجمالي المستفيدين" value={stats?.students} color="#1B7A3D" bg="#E8F5EE" testid="stat-students" />
        <StatCard icon={Smartphone} label="حسابات واتساب" value={stats?.accounts} color="#3B82F6" bg="#EFF6FF" testid="stat-accounts" />
        <StatCard icon={FolderKanban} label="المجموعات" value={stats?.groups} color="#8B5CF6" bg="#F5F3FF" testid="stat-groups" />
        <StatCard icon={FileText} label="القوالب" value={stats?.templates} color="#F59E0B" bg="#FEF3C7" testid="stat-templates" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={CheckCircle2} label="رسائل أُرسلت" value={stats?.messages_sent} color="#10B981" bg="#ECFDF5" testid="stat-sent" />
        <StatCard icon={Clock} label="رسائل قيد الانتظار" value={stats?.messages_pending} color="#F59E0B" bg="#FEF3C7" testid="stat-pending" />
        <StatCard icon={AlertCircle} label="رسائل فشلت" value={stats?.messages_failed} color="#EF4444" bg="#FEF2F2" testid="stat-failed" />
        <StatCard icon={Send} label="حملات نشطة" value={stats?.campaigns_running} color="#C41E24" bg="#FCE9EA" testid="stat-running" />
      </div>

      <Card className="p-6 border-slate-200">
        <h2 className="font-heading text-xl font-bold mb-4">إرشادات لتجنب حظر الحسابات</h2>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          {[
            ["لا ترسل أكثر من 500 رسالة يومياً من الحساب الجديد","ابدأ تدريجياً وزِد الحجم خلال الأسبوع الأول"],
            ["استخدم عدة حسابات وقم بتوزيع الحمل بينها","النظام يقوم بالتوزيع تلقائياً (Account Rotation)"],
            ["اجعل الفواصل الزمنية بين الرسائل عشوائية","الإعدادات الافتراضية: 5-25 ثانية بين كل رسالة"],
            ["استخدم Spintax لتنويع نصوص الرسائل","مثال: {مرحباً|أهلاً} {بك|بكم} في المؤسسة"],
            ["لا ترسل خارج ساعات العمل (9 صباحاً - 9 مساءً)","قابل للتعديل من الإعدادات"],
            ["تأكد من حصولك على موافقة المستفيدين مسبقاً","رسائل المستفيدين المسجلين فقط"],
          ].map(([t, d], i) => (
            <div key={i} className="flex gap-3 p-3 rounded-lg bg-slate-50">
              <div className="w-7 h-7 rounded-full bg-[#1B7A3D] text-white text-xs font-bold flex items-center justify-center shrink-0">{i+1}</div>
              <div>
                <div className="font-semibold text-slate-900">{t}</div>
                <div className="text-slate-500 mt-0.5">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
