import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Input = ({ className, type, ...props }: ComponentProps<"input">) => (
  <input
    type={type}
    data-slot="input"
    className={cn(
      "flex h-11 w-full min-w-0 rounded-[3px] border border-input bg-card px-3.5 text-base text-foreground placeholder:text-muted-foreground file:mr-3 file:border-0 file:bg-transparent file:font-semibold file:text-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
      className,
    )}
    {...props}
  />
);
