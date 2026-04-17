import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUser, UserProfile } from "@clerk/react";
import { Settings } from "lucide-react";

export default function SettingsPage() {
  const { data: currentUser } = useCurrentUser();
  const { user } = useUser();

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6" />
          Account Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your profile for{" "}
          <span className="font-medium text-foreground">{currentUser?.name ?? user?.fullName ?? "your account"}</span>
        </p>
      </div>

      <div className="flex justify-center">
        <UserProfile routing="hash" />
      </div>
    </div>
  );
}
