export {
  addComment,
  deleteOwnComment,
  fetchComments,
  fetchLatestPost,
  fetchPostsFeed,
  setCommentLike,
  type CommentItem,
  type CommentTargetType,
  type PostItem,
} from "@/modules/posts/core/postsClient";
export { CommentsSection } from "@/modules/posts/ui/CommentsSection";
export { LatestPostBanner } from "@/modules/posts/ui/LatestPostBanner";
export { PostScreen } from "@/modules/posts/ui/PostScreen";
export { PostsFeedScreen } from "@/modules/posts/ui/PostsFeedScreen";
