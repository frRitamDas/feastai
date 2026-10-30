"use client";

import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import { motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Chat } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import { LoaderIcon } from "./icons";
import { ChatItem } from "./sidebar-history-item";

type GroupedChats = {
  today: Chat[];
  yesterday: Chat[];
  lastWeek: Chat[];
  lastMonth: Chat[];
  older: Chat[];
};

export type ChatHistory = {
  chats: Chat[];
  hasMore: boolean;
};

const PAGE_SIZE = 20;

const groupChatsByDate = (chats: Chat[]): GroupedChats => {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  return chats.reduce(
    (groups, chat) => {
      const chatDate = new Date(chat.createdAt);

      if (isToday(chatDate)) {
        groups.today.push(chat);
      } else if (isYesterday(chatDate)) {
        groups.yesterday.push(chat);
      } else if (chatDate > oneWeekAgo) {
        groups.lastWeek.push(chat);
      } else if (chatDate > oneMonthAgo) {
        groups.lastMonth.push(chat);
      } else {
        groups.older.push(chat);
      }

      return groups;
    },
    {
      lastMonth: [],
      lastWeek: [],
      older: [],
      today: [],
      yesterday: [],
    } as GroupedChats
  );
};

export function getChatHistoryPaginationKey(
  pageIndex: number,
  previousPageData: ChatHistory
) {
  if (previousPageData && previousPageData.hasMore === false) {
    return null;
  }

  if (pageIndex === 0) {
    return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?limit=${PAGE_SIZE}`;
  }

  const firstChatFromPage = previousPageData.chats.at(-1);

  if (!firstChatFromPage) {
    return null;
  }

  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?ending_before=${firstChatFromPage.id}&limit=${PAGE_SIZE}`;
}

export function SidebarHistory({ user }: { user: User | undefined }) {
  const { setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const id = pathname?.startsWith("/chat/") ? pathname.split("/")[2] : null;

  const {
    data: paginatedChatHistories,
    setSize,
    isValidating,
    isLoading,
    mutate,
  } = useSWRInfinite<ChatHistory>(
    user ? getChatHistoryPaginationKey : () => null,
    fetcher,
    { fallbackData: [], revalidateOnFocus: false }
  );

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);
  const {
    data: searchResults,
    error: searchError,
    isLoading: searchLoading,
    mutate: refreshSearch,
  } = useSWR<{ chats: Chat[] }>(
    user && debouncedSearch
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history/search?q=${encodeURIComponent(debouncedSearch)}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );
  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setSearch(event.target.value),
    []
  );

  const router = useRouter();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const hasReachedEnd = paginatedChatHistories
    ? paginatedChatHistories.some((page) => page.hasMore === false)
    : false;

  const hasEmptyChatHistory = paginatedChatHistories
    ? paginatedChatHistories.every((page) => page.chats.length === 0)
    : false;

  const handleDelete = useCallback(async () => {
    const chatToDelete = deleteId;
    if (!chatToDelete) {
      return;
    }
    setShowDeleteDialog(false);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat?id=${chatToDelete}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        throw new Error("Delete failed");
      }
      await mutate(
        (chatHistories) =>
          chatHistories?.map((chatHistory) => ({
            ...chatHistory,
            chats: chatHistory.chats.filter((chat) => chat.id !== chatToDelete),
          })),
        { revalidate: false }
      );
      if (pathname === `/chat/${chatToDelete}`) {
        router.replace("/");
      }
      if (debouncedSearch) {
        await refreshSearch();
      }
      toast.success("Conversation deleted");
    } catch {
      toast.error("Could not delete the conversation. Try again.");
    }
  }, [debouncedSearch, deleteId, mutate, pathname, refreshSearch, router]);

  const handleRenamed = useCallback(
    (chatId: string, title: string) => {
      if (debouncedSearch) {
        refreshSearch();
      }
      mutate(
        (histories) =>
          histories?.map((page) => ({
            ...page,
            chats: page.chats.map((chat) =>
              chat.id === chatId ? { ...chat, title } : chat
            ),
          })),
        { revalidate: false }
      );
    },
    [debouncedSearch, mutate, refreshSearch]
  );

  const handleShowDeleteDialog = useCallback((chatId: string) => {
    setDeleteId(chatId);
    setShowDeleteDialog(true);
  }, []);

  const handleViewportEnter = useCallback(() => {
    if (!debouncedSearch && !isValidating && !hasReachedEnd) {
      setSize((size) => size + 1);
    }
  }, [debouncedSearch, hasReachedEnd, isValidating, setSize]);

  if (!user) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-[13px] text-sidebar-foreground/60">
            Login to save and revisit previous chats!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (isLoading) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
          History
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex flex-col gap-0.5 px-1">
            {[44, 32, 28, 64, 52].map((item) => (
              <div
                className="flex h-8 items-center gap-2 rounded-lg px-2"
                key={item}
              >
                <div
                  className="h-3 max-w-(--skeleton-width) flex-1 animate-pulse rounded-md bg-sidebar-foreground/[0.06]"
                  style={
                    {
                      "--skeleton-width": `${item}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
            ))}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (hasEmptyChatHistory) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
          History
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-[13px] text-sidebar-foreground/60">
            Your conversations will appear here once you start chatting!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
          History
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <div className="px-1 pb-3">
            <Input
              aria-label="Search conversations"
              maxLength={100}
              onChange={handleSearchChange}
              placeholder="Search conversations"
              type="search"
              value={search}
            />
          </div>
          {debouncedSearch && searchLoading ? (
            <p className="px-2 text-sm text-muted-foreground">Searching…</p>
          ) : null}
          {debouncedSearch && searchError ? (
            <p className="px-2 text-sm text-destructive">
              Search failed. Try again.
            </p>
          ) : null}
          {debouncedSearch &&
          searchResults &&
          searchResults.chats.length === 0 ? (
            <p className="px-2 text-sm text-muted-foreground">
              No conversations found.
            </p>
          ) : null}
          {debouncedSearch &&
          searchResults &&
          searchResults.chats.length === 50 ? (
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              Showing the first 50 matches.
            </p>
          ) : null}
          <SidebarMenu>
            {paginatedChatHistories
              ? (() => {
                  const chatsFromHistory = debouncedSearch
                    ? (searchResults?.chats ?? [])
                    : paginatedChatHistories.flatMap((page) => page.chats);

                  const groupedChats = groupChatsByDate(chatsFromHistory);

                  return (
                    <div className="flex flex-col gap-4">
                      {groupedChats.today.length > 0 && (
                        <div>
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                            Today
                          </div>
                          {groupedChats.today.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
                              key={chat.id}
                              onDelete={handleShowDeleteDialog}
                              onRenamed={handleRenamed}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </div>
                      )}

                      {groupedChats.yesterday.length > 0 && (
                        <div>
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                            Yesterday
                          </div>
                          {groupedChats.yesterday.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
                              key={chat.id}
                              onDelete={handleShowDeleteDialog}
                              onRenamed={handleRenamed}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </div>
                      )}

                      {groupedChats.lastWeek.length > 0 && (
                        <div>
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                            Last 7 days
                          </div>
                          {groupedChats.lastWeek.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
                              key={chat.id}
                              onDelete={handleShowDeleteDialog}
                              onRenamed={handleRenamed}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </div>
                      )}

                      {groupedChats.lastMonth.length > 0 && (
                        <div>
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                            Last 30 days
                          </div>
                          {groupedChats.lastMonth.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
                              key={chat.id}
                              onDelete={handleShowDeleteDialog}
                              onRenamed={handleRenamed}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </div>
                      )}

                      {groupedChats.older.length > 0 && (
                        <div>
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70">
                            Older
                          </div>
                          {groupedChats.older.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
                              key={chat.id}
                              onDelete={handleShowDeleteDialog}
                              onRenamed={handleRenamed}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()
              : null}
          </SidebarMenu>

          <motion.div onViewportEnter={handleViewportEnter} />

          {hasReachedEnd || debouncedSearch ? null : (
            <div className="mt-1 flex flex-row items-center gap-2 px-4 py-2 text-sidebar-foreground/50">
              <div className="animate-spin">
                <LoaderIcon />
              </div>
              <div className="text-[11px]">Loading...</div>
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              chat and remove it from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
