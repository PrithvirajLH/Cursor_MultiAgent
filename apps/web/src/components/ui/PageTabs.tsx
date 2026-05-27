import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PageTabItem<T extends string = string> = {
  id: T;
  label: string;
  icon?: LucideIcon;
};

export type PageTabsProps<T extends string = string> = {
  tabs: ReadonlyArray<PageTabItem<T>>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
};

/**
 * Underline tab strip used across admin pages (Policies | Coverage | …).
 * Lives on a `border-t` bar; the active tab draws a blue bottom border that
 * sits flush on that bar via the `-mb-px` offset.
 */
export function PageTabs<T extends string = string>({
  tabs,
  active,
  onChange,
  className,
}: PageTabsProps<T>) {
  return (
    <div className={cn("flex space-x-6", className)}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "-mb-px flex items-center space-x-1.5 border-b-2 pb-3 text-sm font-medium transition-colors",
              isActive
                ? "border-blue-600 text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
