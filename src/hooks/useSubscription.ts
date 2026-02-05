 import { useState, useEffect, useCallback } from "react";
 import { supabase } from "@/integrations/supabase/client";
 import { useAuth } from "@/hooks/useAuth";
 
 export interface SubscriptionStatus {
   subscribed: boolean;
   jobAgent: {
     active: boolean;
     endDate: string | null;
     priceId: string | null;
   };
   autoShop: {
     active: boolean;
     endDate: string | null;
     priceId: string | null;
   };
 }
 
 // Price IDs from Stripe
 export const PRICE_IDS = {
   JOB_AGENT_MONTHLY: "price_1SxO3109W4lOj3kbCBdVHME4",
   AUTO_SHOP_WEEKLY: "price_1SxO3T09W4lOj3kbLHLDCn94",
 };
 
 export const useSubscription = () => {
   const { user } = useAuth();
   const [status, setStatus] = useState<SubscriptionStatus | null>(null);
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState<string | null>(null);
 
   const checkSubscription = useCallback(async () => {
     if (!user) {
       setStatus(null);
       setLoading(false);
       return;
     }
 
     try {
       setLoading(true);
       const { data, error } = await supabase.functions.invoke("check-subscription");
       
       if (error) throw error;
       setStatus(data);
       setError(null);
     } catch (err: any) {
       console.error("Subscription check error:", err);
       setError(err.message);
       setStatus({
         subscribed: false,
         jobAgent: { active: false, endDate: null, priceId: null },
         autoShop: { active: false, endDate: null, priceId: null },
       });
     } finally {
       setLoading(false);
     }
   }, [user]);
 
   useEffect(() => {
     checkSubscription();
   }, [checkSubscription]);
 
   // Auto-refresh every minute
   useEffect(() => {
     if (!user) return;
     const interval = setInterval(checkSubscription, 60000);
     return () => clearInterval(interval);
   }, [user, checkSubscription]);
 
   const startCheckout = async (priceId: string) => {
     try {
       const { data, error } = await supabase.functions.invoke("create-checkout", {
         body: { priceId },
       });
 
       if (error) throw error;
       if (data?.url) {
         window.open(data.url, "_blank");
       }
     } catch (err: any) {
       console.error("Checkout error:", err);
       throw err;
     }
   };
 
   const openCustomerPortal = async () => {
     try {
       const { data, error } = await supabase.functions.invoke("customer-portal");
 
       if (error) throw error;
       if (data?.url) {
         window.open(data.url, "_blank");
       }
     } catch (err: any) {
       console.error("Portal error:", err);
       throw err;
     }
   };
 
   return {
     status,
     loading,
     error,
     checkSubscription,
     startCheckout,
     openCustomerPortal,
     hasJobAgent: status?.jobAgent?.active ?? false,
     hasAutoShop: status?.autoShop?.active ?? false,
   };
 };