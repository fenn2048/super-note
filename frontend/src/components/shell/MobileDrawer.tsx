/**
 * 移动端侧滑抽屉（遮罩 + Sidebar）
 * Motion: springs.sheet + sheetFromLeft — DESIGN.md §13
 */
import React from "react";
import { AnimatePresence } from "framer-motion";
import { useApp, useAppActions } from "@/store/AppContext";
import Sidebar from "@/components/Sidebar";
import { Motion } from "@/components/common/Motion";
import { springs, variants } from "@/lib/motion";

export default function MobileDrawer() {
  const { state } = useApp();
  const actions = useAppActions();

  return (
    <AnimatePresence>
      {state.mobileSidebarOpen && (
        <>
          <Motion.div
            variants={variants.scrimFade}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.2 }}
            onClick={() => actions.setMobileSidebar(false)}
            className="fixed inset-0 z-drawer-backdrop bg-black/50 backdrop-blur-sm md:hidden"
            aria-hidden
          />
          <Motion.div
            variants={variants.sheetFromLeft}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={springs.sheet}
            className="fixed inset-y-0 left-0 z-drawer w-[86%] max-w-[340px] md:hidden shadow-xl flex bg-app-sidebar"
            style={{ paddingBottom: "var(--safe-area-bottom)" }}
            role="dialog"
            aria-modal="true"
            aria-label="导航菜单"
          >
            <Sidebar variant="mobile" />
          </Motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
