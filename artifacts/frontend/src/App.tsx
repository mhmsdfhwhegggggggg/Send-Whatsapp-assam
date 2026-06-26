import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { Toaster } from "sonner";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Students from "@/pages/Students";
import Groups from "@/pages/Groups";
import Templates from "@/pages/Templates";
import Accounts from "@/pages/Accounts";
import Campaigns from "@/pages/Campaigns";
import CampaignDetail from "@/pages/CampaignDetail";
import Settings from "@/pages/Settings";
import Layout from "@/components/Layout";

function useAuth() {
  return !!localStorage.getItem("token");
}

function PrivateRoute({ component: Component, ...props }: { component: React.ComponentType; path: string }) {
  const auth = useAuth();
  if (!auth) return <Redirect to="/login" />;
  return (
    <Route {...props}>
      <Layout>
        <Component />
      </Layout>
    </Route>
  );
}

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <WouterRouter base={base}>
      <Switch>
        <Route path="/login" component={Login} />
        <PrivateRoute path="/" component={Dashboard} />
        <PrivateRoute path="/students" component={Students} />
        <PrivateRoute path="/groups" component={Groups} />
        <PrivateRoute path="/templates" component={Templates} />
        <PrivateRoute path="/accounts" component={Accounts} />
        <PrivateRoute path="/campaigns" component={Campaigns} />
        <PrivateRoute path="/campaigns/:id" component={CampaignDetail} />
        <PrivateRoute path="/settings" component={Settings} />
        <Route>{() => <Redirect to="/" />}</Route>
      </Switch>
      <Toaster position="top-center" richColors />
    </WouterRouter>
  );
}

export default App;
