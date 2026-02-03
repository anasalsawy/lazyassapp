import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AppRole = "owner" | "family";

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
  owner_id: string | null;
  created_at: string;
}

export const useUserRole = () => {
  const { user } = useAuth();
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const fetchRole = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching user role:", error);
        // If no role exists, user is likely an owner (first user)
        setIsOwner(true);
        setOwnerId(user.id);
      } else if (data) {
        // Cast to our type since DB returns the role as string
        const role = data as unknown as UserRole;
        setUserRole(role);
        setIsOwner(role.role === "owner");
        setOwnerId(role.role === "owner" ? user.id : role.owner_id);
      } else {
        // No role record - treat as owner (will need to be set up)
        setIsOwner(true);
        setOwnerId(user.id);
      }
    } catch (error) {
      console.error("Error fetching user role:", error);
      setIsOwner(true);
      setOwnerId(user.id);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchRole();
  }, [fetchRole]);

  // Set user as owner (for first-time setup)
  const setAsOwner = async () => {
    if (!user) return false;

    try {
      const { error } = await supabase
        .from("user_roles")
        .upsert({
          user_id: user.id,
          role: "owner" as AppRole,
          owner_id: null,
        });

      if (error) throw error;
      await fetchRole();
      return true;
    } catch (error) {
      console.error("Error setting as owner:", error);
      return false;
    }
  };

  // Add a family member (owner only)
  const addFamilyMember = async (familyUserId: string) => {
    if (!user || !isOwner) return false;

    try {
      const { error } = await supabase
        .from("user_roles")
        .insert({
          user_id: familyUserId,
          role: "family" as AppRole,
          owner_id: user.id,
        });

      if (error) throw error;
      return true;
    } catch (error) {
      console.error("Error adding family member:", error);
      return false;
    }
  };

  return {
    userRole,
    loading,
    isOwner,
    ownerId,
    setAsOwner,
    addFamilyMember,
    refreshRole: fetchRole,
  };
};
