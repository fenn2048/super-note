/**
 * 移动端侧滑抽屉（遮罩 + Sidebar）
 */
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useApp, useAppActions } from "@/store/AppContext";
import Sidebar from "@/components/Sidebar";

export default function MobileDrawer() {
  const { state } = useApp();
  const actions = useAppActions();

  return (
    <AnimatePresence>
      {state.mobileSidebarOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => actions.setMobileSidebar(false)}
            className="fixed inset-0 z-drawer-backdrop bg-black/50 backdrop-blur-sm md:hidden"
            aria-hidden
          />
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            className="fixed inset-y-0 left-0 z-drawer w-[86%] max-w-[340px] md:hidden shadow-2xl flex bg-app-sidebar"
            style={{ paddingBottom: "var(--safe-area-bottom)" }}
            role="dialog"
            aria-modal="true"
            aria-label="导航菜单"
          >
            <Sidebar variant="mobile" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
