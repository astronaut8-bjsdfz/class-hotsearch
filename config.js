/* ============================================================
   config.js —— 数据库连接配置
   ------------------------------------------------------------
   这两个值是「可以公开」的：
     - 别人拿到它们，也只能按数据库定好的规则来 —— 只能提交、
       只能点赞，删不掉任何内容，也改不了别人的内容。
     - 真正的权限控制在数据库那边（行级安全策略），不在这两个值上。
       这一点我实测过了：用这个密钥发删除请求，数据库直接拒绝。
     - 这个文件会跟着网页一起公开发布，这是正常做法，不用担心。

   ⚠️ 千万不要把 Supabase 的 Secret key（sb_secret_ 开头）填到这里。
      那个是管理员钥匙，能绕过所有规则，只能待在服务器上。
   ============================================================ */

window.HOTSEARCH_BACKEND = {

  /* Supabase 项目地址 */
  url: "https://jjyospedfdctgjhmhnex.supabase.co",

  /* 公开密钥（Publishable key） */
  anonKey: "sb_publishable_3Hj8gpHOwqcEAozNka_kFQ_GYgxyDOV",

  /* 表名，不用改 */
  table: "hot_items",

  /* 公告表名，不用改 */
  announceTable: "announcements",

  /* 评论表名，不用改（每条热搜的讨论板存在这里） */
  commentTable: "comments"

};
