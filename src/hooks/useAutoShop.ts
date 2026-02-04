import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";

export interface PaymentCard {
  id: string;
  card_name: string;
  card_number_enc: string;
  expiry_enc: string;
  cvv_enc: string;
  cardholder_name: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_zip?: string;
  billing_country?: string;
  is_default: boolean;
  created_at: string;
  user_id: string;
}

export interface ShippingAddress {
  id: string;
  address_name: string;
  full_name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  phone?: string;
  is_default: boolean;
  created_at: string;
  user_id: string;
}

export interface AutoShopOrder {
  id: string;
  product_query: string;
  max_price?: number;
  quantity: number;
  shipping_address_id?: string;
  status: string;
  selected_deal_url?: string;
  selected_deal_price?: number;
  selected_deal_site?: string;
  order_confirmation?: string;
  cards_tried: string[];
  sites_tried: string[];
  browser_use_task_id?: string;
  error_message?: string;
  notes?: string;
  created_at: string;
  completed_at?: string;
}

export interface OrderEmail {
  id: string;
  user_id: string;
  order_id?: string;
  gmail_message_id: string;
  thread_id?: string;
  from_email: string;
  from_name?: string;
  to_email?: string;
  subject: string;
  snippet?: string;
  body_text?: string;
  body_html?: string;
  received_at: string;
  is_read: boolean;
  email_type: string;
  extracted_data: Record<string, unknown>;
  created_at: string;
}

// Simple XOR encryption for card data (in production, use proper encryption)
const encryptData = (data: string): string => {
  const key = "autoshop-enc-key";
  let result = "";
  for (let i = 0; i < data.length; i++) {
    result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result);
};

const decryptData = (data: string): string => {
  const key = "autoshop-enc-key";
  const decoded = atob(data);
  let result = "";
  for (let i = 0; i < decoded.length; i++) {
    result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
};

export const useAutoShop = () => {
  const { user } = useAuth();
  const { isOwner, ownerId, loading: roleLoading } = useUserRole();
  const { toast } = useToast();
  const [cards, setCards] = useState<PaymentCard[]>([]);
  const [addresses, setAddresses] = useState<ShippingAddress[]>([]);
  const [orders, setOrders] = useState<AutoShopOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user || roleLoading) return;
    setLoading(true);

    try {
      // Cards: owner's cards are used for everyone
      // The RLS policy allows family to see owner's cards
      const effectiveOwnerId = ownerId || user.id;
      
      const [cardsRes, addressesRes, ordersRes] = await Promise.all([
        // Fetch cards from owner (or self if owner)
        supabase
          .from("payment_cards")
          .select("*")
          .eq("user_id", effectiveOwnerId)
          .order("is_default", { ascending: false }),
        // Addresses can be user's own or from owner
        supabase
          .from("shipping_addresses")
          .select("*")
          .or(`user_id.eq.${user.id},user_id.eq.${effectiveOwnerId}`)
          .order("is_default", { ascending: false }),
        // Orders are always user's own
        supabase
          .from("auto_shop_orders")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
      ]);

      if (cardsRes.data) setCards(cardsRes.data as PaymentCard[]);
      if (addressesRes.data) setAddresses(addressesRes.data as ShippingAddress[]);
      if (ordersRes.data) setOrders(ordersRes.data as AutoShopOrder[]);
    } catch (error) {
      console.error("Error fetching auto-shop data:", error);
    } finally {
      setLoading(false);
    }
  }, [user, ownerId, roleLoading]);

  useEffect(() => {
    if (!roleLoading) {
      fetchData();
    }
  }, [fetchData, roleLoading]);

  // Card operations
  const addCard = async (cardData: {
    card_name: string;
    card_number: string;
    expiry: string;
    cvv: string;
    cardholder_name: string;
    billing_address?: string;
    billing_city?: string;
    billing_state?: string;
    billing_zip?: string;
    billing_country?: string;
    is_default?: boolean;
  }) => {
    if (!user) return null;

    const { data, error } = await supabase
      .from("payment_cards")
      .insert({
        user_id: user.id,
        card_name: cardData.card_name,
        card_number_enc: encryptData(cardData.card_number),
        expiry_enc: encryptData(cardData.expiry),
        cvv_enc: encryptData(cardData.cvv),
        cardholder_name: cardData.cardholder_name,
        billing_address: cardData.billing_address,
        billing_city: cardData.billing_city,
        billing_state: cardData.billing_state,
        billing_zip: cardData.billing_zip,
        billing_country: cardData.billing_country || "US",
        is_default: cardData.is_default || false,
      })
      .select()
      .single();

    if (error) {
      toast({ title: "Failed to add card", variant: "destructive" });
      return null;
    }

    toast({ title: "Card added successfully" });
    fetchData();
    return data;
  };

  const deleteCard = async (cardId: string) => {
    const { error } = await supabase
      .from("payment_cards")
      .delete()
      .eq("id", cardId);

    if (error) {
      toast({ title: "Failed to delete card", variant: "destructive" });
      return false;
    }

    toast({ title: "Card deleted" });
    fetchData();
    return true;
  };

  // Address operations
  const addAddress = async (addressData: Omit<ShippingAddress, "id" | "created_at" | "user_id">) => {
    if (!user) return null;

    const { data, error } = await supabase
      .from("shipping_addresses")
      .insert({
        user_id: user.id,
        ...addressData,
      })
      .select()
      .single();

    if (error) {
      toast({ title: "Failed to add address", variant: "destructive" });
      return null;
    }

    toast({ title: "Address added successfully" });
    fetchData();
    return data;
  };

  const deleteAddress = async (addressId: string) => {
    const { error } = await supabase
      .from("shipping_addresses")
      .delete()
      .eq("id", addressId);

    if (error) {
      toast({ title: "Failed to delete address", variant: "destructive" });
      return false;
    }

    toast({ title: "Address deleted" });
    fetchData();
    return true;
  };

  // Order operations
  const startOrder = async (orderData: {
    product_query: string;
    max_price?: number;
    quantity?: number;
    shipping_address_id: string;
  }) => {
    if (!user) return null;

    if (cards.length === 0) {
      toast({ title: "Please add at least one payment card", variant: "destructive" });
      return null;
    }

    if (addresses.length === 0) {
      toast({ title: "Please add a shipping address", variant: "destructive" });
      return null;
    }

    try {
      // Create the order record first
      const { data: order, error } = await supabase
        .from("auto_shop_orders")
        .insert({
          user_id: user.id,
          product_query: orderData.product_query,
          max_price: orderData.max_price,
          quantity: orderData.quantity || 1,
          shipping_address_id: orderData.shipping_address_id,
          status: "pending",
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "🛒 Shopping Agent Starting",
        description: `Searching for "${orderData.product_query}"...`,
      });

      // Get shipping address details
      const selectedAddress = addresses.find(a => a.id === orderData.shipping_address_id);
      
      // Get all card details (decrypted) for the agent
      const cardDetails = cards.map(card => ({
        id: card.id,
        cardNumber: decryptData(card.card_number_enc),
        expiry: decryptData(card.expiry_enc),
        cvv: decryptData(card.cvv_enc),
        cardholderName: card.cardholder_name,
        billingAddress: card.billing_address,
        billingCity: card.billing_city,
        billingState: card.billing_state,
        billingZip: card.billing_zip,
        billingCountry: card.billing_country,
      }));

      // Call the auto-shop edge function
      const { data: agentResult, error: agentError } = await supabase.functions.invoke(
        "auto-shop",
        {
          body: {
            action: "start_order",
            orderId: order.id,
            productQuery: orderData.product_query,
            maxPrice: orderData.max_price,
            quantity: orderData.quantity || 1,
            shippingAddress: selectedAddress,
            paymentCards: cardDetails,
          },
        }
      );

      if (agentError) throw agentError;

      toast({
        title: "🔍 Agent Searching",
        description: "Looking for the best deals across multiple sites...",
      });

      fetchData();
      return order;
    } catch (error: any) {
      console.error("Order error:", error);
      toast({
        title: "Failed to start order",
        description: error.message,
        variant: "destructive",
      });
      return null;
    }
  };

  const cancelOrder = async (orderId: string) => {
    const { error } = await supabase
      .from("auto_shop_orders")
      .update({ status: "cancelled" })
      .eq("id", orderId);

    if (error) {
      toast({ title: "Failed to cancel order", variant: "destructive" });
      return false;
    }

    toast({ title: "Order cancelled" });
    fetchData();
    return true;
  };

  // Get masked card number for display
  const getMaskedCardNumber = (encryptedNumber: string) => {
    try {
      const decrypted = decryptData(encryptedNumber);
      return `•••• ${decrypted.slice(-4)}`;
    } catch {
      return "•••• ????";
    }
  };

  return {
    cards,
    addresses,
    orders,
    loading: loading || roleLoading,
    isOwner,
    addCard,
    deleteCard,
    addAddress,
    deleteAddress,
    startOrder,
    cancelOrder,
    getMaskedCardNumber,
    refreshData: fetchData,
  };
};
