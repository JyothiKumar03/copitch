import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex w-fit max-w-full shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold leading-snug [&_svg]:size-3 [&_svg]:shrink-0", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground",
      secondary: "border-transparent bg-muted text-foreground",
      destructive: "border-destructive/30 bg-destructive/10 text-destructive",
      outline: "border-border text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

type TBadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean };

export const Badge = ({ asChild = false, className, variant, ...props }: TBadgeProps) => {
  const Component = asChild ? Slot : "span";
  return <Component data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
};
