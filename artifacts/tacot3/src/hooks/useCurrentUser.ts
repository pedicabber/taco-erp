import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { apiClient } from "@/lib/apiClient";

export function useCurrentUser() {
  const { isSignedIn } = useAuth();
  return useQuery({
    queryKey: ["current-user"],
    queryFn: () => apiClient.get("/users/me").then(r => r.data),
    enabled: !!isSignedIn,
    staleTime: 0,
  });
}
