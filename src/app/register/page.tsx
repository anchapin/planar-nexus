"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { syncApiSession } from "@/lib/client-api-session";

const USER_STORAGE_KEY = "planar_nexus_user";

interface StoredUser {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

function generateUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !username || !password) {
      setError("All fields are required");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setIsLoading(true);

    const userId = generateUserId();
    const user: StoredUser = {
      id: userId,
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));

    try {
      await syncApiSession();
      router.push("/dashboard");
    } catch {
      setError("Failed to create session. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-md border-slate-700 bg-slate-800/80 shadow-xl backdrop-blur">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold text-slate-100">
            Create an account
          </CardTitle>
          <CardDescription className="text-slate-400">
            Enter your details below to create your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-300">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="border-slate-600 bg-slate-900/50 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username" className="text-slate-300">
                Username
              </Label>
              <Input
                id="username"
                type="text"
                placeholder="yourname"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="border-slate-600 bg-slate-900/50 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-300">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-slate-600 bg-slate-900/50 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-slate-300">
                Confirm Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="border-slate-600 bg-slate-900/50 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
                disabled={isLoading}
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={isLoading}
            >
              {isLoading ? "Creating account..." : "Create account"}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm text-slate-400">
            Already have an account?{" "}
            <a
              href="/login"
              className="text-emerald-400 hover:text-emerald-300"
            >
              Sign in
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
