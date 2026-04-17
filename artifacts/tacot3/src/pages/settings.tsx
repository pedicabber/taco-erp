import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useUser } from "@clerk/react";
import { useLocation, Redirect } from "wouter";
import { Settings, User, Mail, Shield, Building2, Calendar, Loader2, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { format } from "date-fns";

export default function SettingsPage() {
  const { data: currentUser, isLoading } = useCurrentUser();
  const { user: clerkUser } = useUser();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (currentUser?.role === "admin") {
    return <Redirect to="/admin" />;
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-start gap-3">
        <div className="p-2 rounded-lg bg-muted">
          <Settings className="w-5 h-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Account Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your profile and account information</p>
        </div>
      </div>

      {/* Profile card */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Avatar + name */}
          <div className="flex items-center gap-4">
            {clerkUser?.imageUrl ? (
              <img
                src={clerkUser.imageUrl}
                alt={currentUser?.name ?? "Avatar"}
                className="w-16 h-16 rounded-full object-cover border border-border"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary border border-border">
                {currentUser?.name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div>
              <p className="text-lg font-semibold">{currentUser?.name ?? clerkUser?.fullName ?? "—"}</p>
              <p className="text-sm text-muted-foreground">{currentUser?.email ?? clerkUser?.primaryEmailAddress?.emailAddress}</p>
            </div>
          </div>

          <Separator />

          {/* Info rows */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Role</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="capitalize font-medium">{currentUser?.role ?? "member"}</span>
                <Badge variant="secondary" className="text-[10px] capitalize">
                  {currentUser?.role ?? "member"}
                </Badge>
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Department</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-medium">{currentUser?.departmentName ?? "No department"}</span>
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Email</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-medium truncate">{currentUser?.email ?? "—"}</span>
              </div>
            </div>

            <div>
              <Label className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Member Since</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-medium">
                  {currentUser?.createdAt
                    ? format(new Date(currentUser.createdAt), "MMM d, yyyy")
                    : "—"}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        To change your name, photo, or password, contact your administrator.
      </p>
    </div>
  );
}
