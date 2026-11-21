import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Textarea = ({ className, ...props }: ComponentProps<"textarea">) => (
  <textarea
    data-slot="textarea"
    className={cn(
      "flex min-h-24 w-full resize-y rounded-[3px] border border-input bg-card px-3.5 py-3 text-base leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
      className,
    )}
    {...props}
  />
);
