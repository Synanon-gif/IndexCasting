/**
 * Social Features: Posts, Stories, Likes, Comments, Follows.
 * Tabellen aus Phase 2 (posts, post_likes, post_comments, follows).
 */
import { supabase } from '../../lib/supabase';

export type Post = {
  id: string;
  author_id: string;
  type: 'post' | 'story';
  media_urls: string[];
  caption: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PostLike = {
  post_id: string;
  user_id: string;
  created_at: string;
};

export type PostComment = {
  id: string;
  post_id: string;
  author_id: string;
  text: string;
  created_at: string;
};

// ---- Posts ----

export async function getFeed(userId: string, limit = 20, offset = 0): Promise<Post[]> {
  const { data: followedIds } = await supabase
    .from('follows')
    .select('followed_id')
    .eq('follower_id', userId);

  const ids = (followedIds ?? []).map((f: any) => f.followed_id);
  ids.push(userId); // Include own posts

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .in('author_id', ids)
    .eq('type', 'post')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) { console.error('getFeed error:', error); return []; }
  return (data ?? []) as Post[];
}

export async function getStories(userId: string): Promise<Post[]> {
  const { data: followedIds } = await supabase
    .from('follows')
    .select('followed_id')
    .eq('follower_id', userId);

  const ids = (followedIds ?? []).map((f: any) => f.followed_id);
  ids.push(userId);

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .in('author_id', ids)
    .eq('type', 'story')
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) { console.error('getStories error:', error); return []; }
  return (data ?? []) as Post[];
}

export async function getUserPosts(authorId: string): Promise<Post[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('author_id', authorId)
    .order('created_at', { ascending: false });
  if (error) { console.error('getUserPosts error:', error); return []; }
  return (data ?? []) as Post[];
}

export async function createPost(
  authorId: string,
  type: 'post' | 'story',
  mediaUrls: string[],
  caption?: string
): Promise<Post | null> {
  const expiresAt = type === 'story'
    ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: authorId,
      type,
      media_urls: mediaUrls,
      caption: caption || null,
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (error) { console.error('createPost error:', error); return null; }
  return data as Post;
}

export async function deletePost(postId: string): Promise<boolean> {
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) { console.error('deletePost error:', error); return false; }
  return true;
}

// ---- Likes ----

export async function likePost(postId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('post_likes')
    .insert({ post_id: postId, user_id: userId });
  if (error) {
    if (error.code === '23505') return true;
    console.error('likePost error:', error);
    return false;
  }
  return true;
}

export async function unlikePost(postId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('post_likes')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);
  if (error) { console.error('unlikePost error:', error); return false; }
  return true;
}

export async function getLikeCount(postId: string): Promise<number> {
  const { count, error } = await supabase
    .from('post_likes')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);
  if (error) return 0;
  return count ?? 0;
}

export async function hasUserLiked(postId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('post_likes')
    .select('post_id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

// ---- Comments ----

export async function getComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase
    .from('post_comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) { console.error('getComments error:', error); return []; }
  return (data ?? []) as PostComment[];
}

export async function addComment(postId: string, authorId: string, text: string): Promise<PostComment | null> {
  const { data, error } = await supabase
    .from('post_comments')
    .insert({ post_id: postId, author_id: authorId, text })
    .select()
    .single();
  if (error) { console.error('addComment error:', error); return null; }
  return data as PostComment;
}

export async function deleteComment(commentId: string): Promise<boolean> {
  const { error } = await supabase.from('post_comments').delete().eq('id', commentId);
  if (error) { console.error('deleteComment error:', error); return false; }
  return true;
}

// ---- Follows ----

export async function followUser(followerId: string, followedId: string): Promise<boolean> {
  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: followerId, followed_id: followedId });
  if (error) {
    if (error.code === '23505') return true;
    console.error('followUser error:', error);
    return false;
  }
  return true;
}

export async function unfollowUser(followerId: string, followedId: string): Promise<boolean> {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followed_id', followedId);
  if (error) { console.error('unfollowUser error:', error); return false; }
  return true;
}

export async function getFollowerCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('followed_id', userId);
  if (error) return 0;
  return count ?? 0;
}

export async function getFollowingCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('follower_id', userId);
  if (error) return 0;
  return count ?? 0;
}

export async function isFollowing(followerId: string, followedId: string): Promise<boolean> {
  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('follower_id', followerId)
    .eq('followed_id', followedId)
    .maybeSingle();
  return !!data;
}

export async function getFollowers(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('follower_id')
    .eq('followed_id', userId);
  if (error) return [];
  return (data ?? []).map((d: any) => d.follower_id);
}

export async function getFollowing(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('follows')
    .select('followed_id')
    .eq('follower_id', userId);
  if (error) return [];
  return (data ?? []).map((d: any) => d.followed_id);
}
