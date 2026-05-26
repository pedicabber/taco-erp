import { useEffect, useRef, lazy, Suspense } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useAuth, useClerk } from "@clerk/react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";
import { apiClient } from "@/lib/apiClient";
import { GlobalLoadingOverlay, TacoLoadingScreen, useLoadingScreenSettings } from "@/components/GlobalLoadingOverlay";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30 * 1000,
    },
  },
});

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const AppLayout = lazy(() => import("@/components/layout/AppLayout"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const ProjectsPage = lazy(() => import("@/pages/projects"));
const ProjectDetailPage = lazy(() => import("@/pages/project-detail"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const TaskDetailPage = lazy(() => import("@/pages/task-detail"));
const BoardPage = lazy(() => import("@/pages/board"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));
const ActivityFullPage = lazy(() => import("@/pages/activity"));
const AdminPage = lazy(() => import("@/pages/admin"));
const InventoryPage = lazy(() => import("@/pages/inventory"));
const SalesPipelinePage = lazy(() => import("@/pages/sales"));
const OfficeOpsPage = lazy(() => import("@/pages/office-ops"));
const SettingsPage = lazy(() => import("@/pages/settings"));

function PageLoader() {
  // Reuses the same dim + taco-video screen as the global overlay so users
  // never see the old spinner alongside the loading media during lazy route
  // chunk loads. Respects the admin `loading_screen_enabled` setting — when
  // disabled, render nothing (no dim, no media, no spinner).
  const { enabled } = useLoadingScreenSettings();
  if (!enabled) return null;
  return <TacoLoadingScreen />;
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Show when="signed-in" fallback={<Redirect to="/sign-in" />}>
      <Suspense fallback={<PageLoader />}>
        <AppLayout>{children}</AppLayout>
      </Suspense>
    </Show>
  );
}

function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: currentUser, isLoading } = useCurrentUser();
  if (isLoading) return <PageLoader />;
  if (currentUser?.role !== "admin") return <Redirect to="/dashboard" />;
  return <>{children}</>;
}

function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" data-testid="page-sign-in">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" data-testid="page-sign-up">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
          <img
            src={`${import.meta.env.BASE_URL}taco-128.png`}
            alt="TacoT3"
            className="mb-6 w-28 h-28 object-contain drop-shadow-lg"
          />
          <h1 className="text-4xl font-bold tracking-tight">TacoTrackerT3</h1>
          <p className="mt-2 text-muted-foreground text-lg">Engineering Project Operations</p>
          <p className="mt-1 text-sm text-muted-foreground">Track projects, departments, tasks, and timelines</p>
          <a
            href={`${basePath}/sign-in`}
            className="mt-8 rounded-xl bg-primary px-8 py-3 font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-md"
          >
            Sign In
          </a>
        </div>
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ClerkApiAuthBridge() {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    const interceptor = apiClient.interceptors.request.use(async (config) => {
      config.headers = config.headers ?? {};
      if (isSignedIn) {
        const token = await getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      } else {
        delete config.headers.Authorization;
      }
      return config;
    });

    return () => apiClient.interceptors.request.eject(interceptor);
  }, [getToken, isSignedIn]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkApiAuthBridge />
        <ClerkQueryClientCacheInvalidator />
        <GlobalLoadingOverlay />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/dashboard">
            <ProtectedLayout><DashboardPage /></ProtectedLayout>
          </Route>
          <Route path="/projects">
            <ProtectedLayout><ProjectsPage /></ProtectedLayout>
          </Route>
          <Route path="/projects/:projectId">
            <ProtectedLayout><ProjectDetailPage /></ProtectedLayout>
          </Route>
          <Route path="/tasks">
            <ProtectedLayout><TasksPage /></ProtectedLayout>
          </Route>
          <Route path="/tasks/:taskId">
            <ProtectedLayout><TaskDetailPage /></ProtectedLayout>
          </Route>
          <Route path="/board">
            <ProtectedLayout><BoardPage /></ProtectedLayout>
          </Route>
          <Route path="/calendar">
            <ProtectedLayout><CalendarPage /></ProtectedLayout>
          </Route>
          <Route path="/notifications">
            <ProtectedLayout><NotificationsPage /></ProtectedLayout>
          </Route>
          <Route path="/activity">
            <ProtectedLayout><ActivityFullPage /></ProtectedLayout>
          </Route>
          <Route path="/admin">
            <ProtectedLayout><AdminPage /></ProtectedLayout>
          </Route>
          <Route path="/inventory">
            <ProtectedLayout><InventoryPage /></ProtectedLayout>
          </Route>
          <Route path="/sales">
            <ProtectedLayout><AdminLayout><SalesPipelinePage /></AdminLayout></ProtectedLayout>
          </Route>
          <Route path="/office-ops">
            <ProtectedLayout><OfficeOpsPage /></ProtectedLayout>
          </Route>
          <Route path="/settings">
            <ProtectedLayout><SettingsPage /></ProtectedLayout>
          </Route>
          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="tacot3-theme">
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <ClerkProviderWithRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
