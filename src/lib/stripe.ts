import { loadStripe } from "@stripe/stripe-js";

// Live mode publishable key for real card verification
export const stripePromise = loadStripe(
  "pk_live_51Sx7Ab09W4lOj3kb38J5icslUcsb8kqxr4lAb1uaa9ko6BeH7yhVjRHxHrSwdWk2fugYJH6IXXAt3lnEeZaOWe4Q00Cu4m0niZ"
);
