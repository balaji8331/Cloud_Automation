import { redirect } from "next/navigation";

// Root path — redirect to dashboard.
// Middleware will intercept and send unauthenticated users to /login first.
export default function Home() {
  redirect("/dashboard");
}
