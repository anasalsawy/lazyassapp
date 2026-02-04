import { useState } from "react";
import { CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CreditCard, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface StripeCardInputProps {
  userEmail?: string;
  onSuccess?: (data: { last4: string; brand: string; paymentIntentId: string }) => void;
  onError?: (error: string) => void;
}

export function StripeCardInput({ userEmail, onSuccess, onError }: StripeCardInputProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [cardholderName, setCardholderName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      toast.error("Stripe not loaded yet");
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      toast.error("Card element not found");
      return;
    }

    setIsProcessing(true);

    try {
      // Create PaymentMethod on the client (secure - no raw card data sent to our server)
      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
        type: "card",
        card: cardElement,
        billing_details: {
          name: cardholderName || undefined,
          email: userEmail || undefined,
        },
      });

      if (pmError) {
        console.error("[StripeCardInput] PaymentMethod error:", pmError);
        toast.error(pmError.message || "Failed to process card");
        onError?.(pmError.message || "Failed to process card");
        return;
      }

      console.log("[StripeCardInput] PaymentMethod created:", paymentMethod.id);

      // Send only the PaymentMethod ID to our edge function for $1 preauth
      const { data, error } = await supabase.functions.invoke("card-preauth", {
        body: {
          paymentMethodId: paymentMethod.id,
          cardholderName,
          email: userEmail,
        },
      });

      if (error) {
        console.error("[StripeCardInput] Edge function error:", error);
        toast.error(error.message || "Card verification failed");
        onError?.(error.message || "Card verification failed");
        return;
      }

      if (data?.success) {
        toast.success(`✅ Card verified! ${data.brand?.toUpperCase()} ****${data.last4}`, {
          description: "No charge - card saved for future purchases",
        });
        onSuccess?.({
          last4: data.last4,
          brand: data.brand,
          paymentIntentId: data.setupIntentId,
        });
        cardElement.clear();
        setCardholderName("");
      } else {
        const errorMsg = data?.error || "Verification failed";
        toast.error(errorMsg);
        onError?.(errorMsg);
      }
    } catch (err: any) {
      console.error("[StripeCardInput] Exception:", err);
      toast.error(err.message || "An error occurred");
      onError?.(err.message || "An error occurred");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cardholder-name">Cardholder Name</Label>
        <Input
          id="cardholder-name"
          placeholder="John Doe"
          value={cardholderName}
          onChange={(e) => setCardholderName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Card Details</Label>
        <div className="border rounded-md p-3 bg-background">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: "16px",
                  color: "hsl(var(--foreground))",
                  "::placeholder": {
                    color: "hsl(var(--muted-foreground))",
                  },
                },
                invalid: {
                  color: "hsl(var(--destructive))",
                },
              },
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Shield className="h-3 w-3" />
        <span>Your card details are encrypted and sent directly to Stripe</span>
      </div>

      <Button type="submit" disabled={!stripe || isProcessing} className="w-full">
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Verifying...
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-4 w-4" />
            Verify Card (no charge)
          </>
        )}
      </Button>
    </form>
  );
}
