import { useState } from "react";
import { useAutoShop, PaymentCard, ShippingAddress } from "@/hooks/useAutoShop";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, MapPin, ShoppingCart, Plus, Trash2, Loader2, Package, CheckCircle, XCircle, Search } from "lucide-react";

const AutoShop = () => {
  const { user, loading: authLoading } = useAuth();
  const {
    cards,
    addresses,
    orders,
    loading,
    addCard,
    deleteCard,
    addAddress,
    deleteAddress,
    startOrder,
    cancelOrder,
    getMaskedCardNumber,
  } = useAutoShop();

  const [activeTab, setActiveTab] = useState("shop");
  const [showAddCard, setShowAddCard] = useState(false);
  const [showAddAddress, setShowAddAddress] = useState(false);
  
  // Form states - simplified to single text blocks
  const [cardForm, setCardForm] = useState({
    card_name: "",
    card_details: "", // Single block: "4111111111111111, 12/25, 123, John Doe"
    billing_details: "", // Single block: "123 Main St, City, ST 12345"
  });

  const [addressForm, setAddressForm] = useState({
    address_name: "",
    shipping_details: "", // Single block: "John Doe, 123 Main St, Apt 4, City, ST 12345, +1-555-1234"
  });

  const [orderForm, setOrderForm] = useState({
    product_query: "",
    max_price: "",
    quantity: "1",
    shipping_address_id: "",
  });

  const [submitting, setSubmitting] = useState(false);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const handleAddCard = async () => {
    if (!cardForm.card_name || !cardForm.card_number || !cardForm.expiry || !cardForm.cvv) {
      return;
    }
    setSubmitting(true);
    await addCard(cardForm);
    setCardForm({
      card_name: "",
      card_number: "",
      expiry: "",
      cvv: "",
      cardholder_name: "",
      billing_address: "",
      billing_city: "",
      billing_state: "",
      billing_zip: "",
    });
    setShowAddCard(false);
    setSubmitting(false);
  };

  const handleAddAddress = async () => {
    if (!addressForm.address_name || !addressForm.full_name || !addressForm.address_line1 || !addressForm.city || !addressForm.state || !addressForm.zip_code) {
      return;
    }
    setSubmitting(true);
    await addAddress(addressForm as Omit<ShippingAddress, "id" | "created_at">);
    setAddressForm({
      address_name: "",
      full_name: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      zip_code: "",
      country: "US",
      phone: "",
    });
    setShowAddAddress(false);
    setSubmitting(false);
  };

  const handleStartOrder = async () => {
    if (!orderForm.product_query || !orderForm.shipping_address_id) {
      return;
    }
    setSubmitting(true);
    await startOrder({
      product_query: orderForm.product_query,
      max_price: orderForm.max_price ? parseFloat(orderForm.max_price) : undefined,
      quantity: parseInt(orderForm.quantity) || 1,
      shipping_address_id: orderForm.shipping_address_id,
    });
    setOrderForm({
      product_query: "",
      max_price: "",
      quantity: "1",
      shipping_address_id: orderForm.shipping_address_id,
    });
    setSubmitting(false);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
      pending: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      searching: { variant: "default", icon: <Search className="h-3 w-3" /> },
      found_deals: { variant: "default", icon: <Package className="h-3 w-3" /> },
      ordering: { variant: "default", icon: <ShoppingCart className="h-3 w-3" /> },
      completed: { variant: "outline", icon: <CheckCircle className="h-3 w-3 text-green-500" /> },
      failed: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
      cancelled: { variant: "secondary", icon: <XCircle className="h-3 w-3" /> },
    };
    const config = statusConfig[status] || statusConfig.pending;
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        {config.icon}
        {status.replace("_", " ").toUpperCase()}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">🛒 Auto-Shop</h1>
          <p className="text-muted-foreground mt-1">
            AI-powered shopping agent that finds the best deals and places orders for you
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="shop" className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Shop
            </TabsTrigger>
            <TabsTrigger value="cards" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Payment Cards ({cards.length})
            </TabsTrigger>
            <TabsTrigger value="addresses" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Addresses ({addresses.length})
            </TabsTrigger>
            <TabsTrigger value="orders" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Orders ({orders.length})
            </TabsTrigger>
          </TabsList>

          {/* Shopping Tab */}
          <TabsContent value="shop">
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Start Shopping</CardTitle>
                  <CardDescription>
                    Tell the AI what to buy and it will find the best deal
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>What do you want to buy?</Label>
                    <Input
                      placeholder="e.g., iPhone 15 Pro 256GB, Sony WH-1000XM5 headphones..."
                      value={orderForm.product_query}
                      onChange={(e) => setOrderForm({ ...orderForm, product_query: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Max Price (optional)</Label>
                      <Input
                        type="number"
                        placeholder="e.g., 500"
                        value={orderForm.max_price}
                        onChange={(e) => setOrderForm({ ...orderForm, max_price: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Quantity</Label>
                      <Input
                        type="number"
                        min="1"
                        value={orderForm.quantity}
                        onChange={(e) => setOrderForm({ ...orderForm, quantity: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Ship To</Label>
                    <Select
                      value={orderForm.shipping_address_id}
                      onValueChange={(value) => setOrderForm({ ...orderForm, shipping_address_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select shipping address" />
                      </SelectTrigger>
                      <SelectContent>
                        {addresses.map((addr) => (
                          <SelectItem key={addr.id} value={addr.id}>
                            {addr.address_name} - {addr.city}, {addr.state}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {addresses.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Add a shipping address first →
                      </p>
                    )}
                  </div>

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleStartOrder}
                    disabled={submitting || !orderForm.product_query || !orderForm.shipping_address_id || cards.length === 0}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="mr-2 h-4 w-4" />
                        Start Shopping Agent
                      </>
                    )}
                  </Button>

                  {cards.length === 0 && (
                    <p className="text-sm text-destructive text-center">
                      ⚠️ Add at least one payment card to start shopping
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>How It Works</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                      1
                    </div>
                    <div>
                      <h4 className="font-medium">Search for Deals</h4>
                      <p className="text-sm text-muted-foreground">
                        AI searches Google Shopping, Amazon, eBay, Walmart, and more
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                      2
                    </div>
                    <div>
                      <h4 className="font-medium">Compare & Select</h4>
                      <p className="text-sm text-muted-foreground">
                        Finds the best price within your budget
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                      3
                    </div>
                    <div>
                      <h4 className="font-medium">Auto-Checkout</h4>
                      <p className="text-sm text-muted-foreground">
                        Fills shipping & payment, tries backup cards if needed
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                      4
                    </div>
                    <div>
                      <h4 className="font-medium">Order Complete</h4>
                      <p className="text-sm text-muted-foreground">
                        Saves confirmation details in your order history
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Cards Tab */}
          <TabsContent value="cards">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Payment Cards</h2>
                <Dialog open={showAddCard} onOpenChange={setShowAddCard}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Card
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Payment Card</DialogTitle>
                      <DialogDescription>
                        Card details are encrypted before storage
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Card Nickname</Label>
                        <Input
                          placeholder="e.g., Chase Sapphire"
                          value={cardForm.card_name}
                          onChange={(e) => setCardForm({ ...cardForm, card_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Card Number</Label>
                        <Input
                          placeholder="1234 5678 9012 3456"
                          value={cardForm.card_number}
                          onChange={(e) => setCardForm({ ...cardForm, card_number: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Expiry (MM/YY)</Label>
                          <Input
                            placeholder="12/25"
                            value={cardForm.expiry}
                            onChange={(e) => setCardForm({ ...cardForm, expiry: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>CVV</Label>
                          <Input
                            placeholder="123"
                            type="password"
                            value={cardForm.cvv}
                            onChange={(e) => setCardForm({ ...cardForm, cvv: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Cardholder Name</Label>
                        <Input
                          placeholder="John Doe"
                          value={cardForm.cardholder_name}
                          onChange={(e) => setCardForm({ ...cardForm, cardholder_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Billing Address (Optional)</Label>
                        <Input
                          placeholder="123 Main St"
                          value={cardForm.billing_address}
                          onChange={(e) => setCardForm({ ...cardForm, billing_address: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          placeholder="City"
                          value={cardForm.billing_city}
                          onChange={(e) => setCardForm({ ...cardForm, billing_city: e.target.value })}
                        />
                        <Input
                          placeholder="State"
                          value={cardForm.billing_state}
                          onChange={(e) => setCardForm({ ...cardForm, billing_state: e.target.value })}
                        />
                        <Input
                          placeholder="ZIP"
                          value={cardForm.billing_zip}
                          onChange={(e) => setCardForm({ ...cardForm, billing_zip: e.target.value })}
                        />
                      </div>
                      <Button onClick={handleAddCard} className="w-full" disabled={submitting}>
                        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save Card
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : cards.length === 0 ? (
                <Card className="py-12">
                  <CardContent className="text-center">
                    <CreditCard className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium text-lg">No payment cards</h3>
                    <p className="text-muted-foreground">Add a card to enable auto-shopping</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {cards.map((card) => (
                    <Card key={card.id}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold">{card.card_name}</h3>
                            <p className="text-lg font-mono">{getMaskedCardNumber(card.card_number_enc)}</p>
                            <p className="text-sm text-muted-foreground">{card.cardholder_name}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteCard(card.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        {card.is_default && (
                          <Badge variant="secondary" className="mt-2">Default</Badge>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Addresses Tab */}
          <TabsContent value="addresses">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Shipping Addresses</h2>
                <Dialog open={showAddAddress} onOpenChange={setShowAddAddress}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Address
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Shipping Address</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Address Nickname</Label>
                        <Input
                          placeholder="e.g., Home, Office"
                          value={addressForm.address_name}
                          onChange={(e) => setAddressForm({ ...addressForm, address_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Full Name</Label>
                        <Input
                          placeholder="John Doe"
                          value={addressForm.full_name}
                          onChange={(e) => setAddressForm({ ...addressForm, full_name: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Address Line 1</Label>
                        <Input
                          placeholder="123 Main Street"
                          value={addressForm.address_line1}
                          onChange={(e) => setAddressForm({ ...addressForm, address_line1: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Address Line 2 (Optional)</Label>
                        <Input
                          placeholder="Apt 4B"
                          value={addressForm.address_line2}
                          onChange={(e) => setAddressForm({ ...addressForm, address_line2: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-2">
                          <Label>City</Label>
                          <Input
                            placeholder="City"
                            value={addressForm.city}
                            onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>State</Label>
                          <Input
                            placeholder="CA"
                            value={addressForm.state}
                            onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>ZIP</Label>
                          <Input
                            placeholder="90210"
                            value={addressForm.zip_code}
                            onChange={(e) => setAddressForm({ ...addressForm, zip_code: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Phone (Optional)</Label>
                        <Input
                          placeholder="+1 555-123-4567"
                          value={addressForm.phone}
                          onChange={(e) => setAddressForm({ ...addressForm, phone: e.target.value })}
                        />
                      </div>
                      <Button onClick={handleAddAddress} className="w-full" disabled={submitting}>
                        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Save Address
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : addresses.length === 0 ? (
                <Card className="py-12">
                  <CardContent className="text-center">
                    <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium text-lg">No shipping addresses</h3>
                    <p className="text-muted-foreground">Add an address to receive your orders</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {addresses.map((addr) => (
                    <Card key={addr.id}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold">{addr.address_name}</h3>
                            <p className="text-sm">{addr.full_name}</p>
                            <p className="text-sm text-muted-foreground">
                              {addr.address_line1}
                              {addr.address_line2 && `, ${addr.address_line2}`}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {addr.city}, {addr.state} {addr.zip_code}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteAddress(addr.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                        {addr.is_default && (
                          <Badge variant="secondary" className="mt-2">Default</Badge>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Orders Tab */}
          <TabsContent value="orders">
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Order History</h2>

              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : orders.length === 0 ? (
                <Card className="py-12">
                  <CardContent className="text-center">
                    <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="font-medium text-lg">No orders yet</h3>
                    <p className="text-muted-foreground">Start shopping to see your orders here</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {orders.map((order) => (
                    <Card key={order.id}>
                      <CardContent className="pt-6">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">{order.product_query}</h3>
                              {getStatusBadge(order.status)}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Qty: {order.quantity}
                              {order.max_price && ` • Max: $${order.max_price}`}
                            </p>
                            {order.selected_deal_site && (
                              <p className="text-sm">
                                Found at: <span className="font-medium">{order.selected_deal_site}</span>
                                {order.selected_deal_price && ` - $${order.selected_deal_price}`}
                              </p>
                            )}
                            {order.order_confirmation && (
                              <p className="text-sm text-green-600">
                                ✓ Confirmation: {order.order_confirmation}
                              </p>
                            )}
                            {order.error_message && (
                              <p className="text-sm text-destructive">
                                ✗ {order.error_message}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {new Date(order.created_at).toLocaleString()}
                            </p>
                          </div>
                          {(order.status === "pending" || order.status === "searching") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => cancelOrder(order.id)}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AutoShop;
