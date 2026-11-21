import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="card" className={cn("min-w-0 rounded-lg border border-border bg-card text-card-foreground", className)} {...props} />
);

export const CardHeader = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="card-header" className={cn("grid gap-1.5 px-5 pt-5", className)} {...props} />
);

export const CardDescription = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
);

export const CardContent = ({ className, ...props }: ComponentProps<"div">) => (
  <div data-slot="card-content" className={cn("min-w-0 p-5", className)} {...props} />
);
