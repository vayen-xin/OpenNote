CREATE DATABASE IF NOT EXISTS opennote CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE opennote;

SET NAMES utf8mb4;

DROP TABLE IF EXISTS doodle_stroke;
DROP TABLE IF EXISTS doodle_note;
DROP TABLE IF EXISTS question_attempt;
DROP TABLE IF EXISTS question;
DROP TABLE IF EXISTS chapter;
DROP TABLE IF EXISTS question_bank;

CREATE TABLE question_bank (
  id BIGINT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE chapter (
  id BIGINT PRIMARY KEY,
  bank_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  sort_no INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_chapter_bank FOREIGN KEY (bank_id) REFERENCES question_bank(id),
  INDEX idx_chapter_bank_sort (bank_id, sort_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE question (
  id BIGINT PRIMARY KEY,
  bank_id BIGINT NOT NULL,
  chapter_id BIGINT NOT NULL,
  type ENUM('fill','single_choice') NOT NULL,
  stem TEXT NOT NULL,
  options_json JSON NULL,
  correct_answer_json JSON NOT NULL,
  explanation TEXT NULL,
  sort_no INT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_question_bank FOREIGN KEY (bank_id) REFERENCES question_bank(id),
  CONSTRAINT fk_question_chapter FOREIGN KEY (chapter_id) REFERENCES chapter(id),
  INDEX idx_question_chapter_sort (chapter_id, sort_no),
  INDEX idx_question_bank (bank_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE question_attempt (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL DEFAULT 1,
  question_id BIGINT NOT NULL,
  answer_json JSON NULL,
  status ENUM('unanswered','pending_review','correct','wrong') NOT NULL DEFAULT 'unanswered',
  attempted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_attempt_question FOREIGN KEY (question_id) REFERENCES question(id),
  UNIQUE KEY uk_attempt_user_question (user_id, question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE doodle_note (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL DEFAULT 1,
  question_id BIGINT NOT NULL,
  layer ENUM('question_area','answer_area','full_canvas') NOT NULL DEFAULT 'full_canvas',
  layout_version INT NOT NULL DEFAULT 1,
  base_width INT NOT NULL,
  base_height INT NOT NULL,
  font_scale DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_doodle_question FOREIGN KEY (question_id) REFERENCES question(id),
  UNIQUE KEY uk_doodle_user_question_layer (user_id, question_id, layer)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE doodle_stroke (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  note_id BIGINT NOT NULL,
  seq_no INT NOT NULL,
  tool ENUM('pen','eraser') NOT NULL DEFAULT 'pen',
  color VARCHAR(20) NOT NULL DEFAULT '#FF0000',
  width DECIMAL(6,2) NOT NULL DEFAULT 3.00,
  points_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_stroke_note FOREIGN KEY (note_id) REFERENCES doodle_note(id) ON DELETE CASCADE,
  UNIQUE KEY uk_stroke_note_seq (note_id, seq_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO question_bank (id, name, description) VALUES
(1, '数据结构与算法', '刷题基础题库'),
(2, '计算机网络', '网络核心知识题库');

INSERT INTO chapter (id, bank_id, title, sort_no) VALUES
(101, 1, '第一章 数组与链表', 1),
(102, 1, '第二章 栈与队列', 2),
(103, 1, '第三章 树与图', 3),
(201, 2, '第一章 OSI 与 TCP/IP', 1),
(202, 2, '第二章 HTTP 基础', 2),
(203, 2, '第三章 传输与安全', 3);

INSERT INTO question (id, bank_id, chapter_id, type, stem, options_json, correct_answer_json, explanation, sort_no) VALUES
(1,1,101,'single_choice','下列哪种数据结构适合实现 LRU 缓存？',JSON_ARRAY('数组','哈希表 + 双向链表','栈','队列'),JSON_OBJECT('index',1),'哈希表 + 双向链表可以在 O(1) 时间内完成查找和更新。',1),
(2,1,101,'fill','单链表中，删除已知前驱节点的后继节点，时间复杂度是 ____。',NULL,JSON_ARRAY('O(1)','o(1)'),'已知前驱节点时可以常数时间删除。',2),
(3,1,101,'single_choice','链表相比数组的主要优势是？',JSON_ARRAY('随机访问快','插入删除灵活','占用更少内存','CPU 缓存友好'),JSON_OBJECT('index',1),'链表在已知位置插入/删除时更灵活。',3),
(4,1,101,'fill','数组按下标访问元素的时间复杂度通常是 ____。',NULL,JSON_ARRAY('O(1)','o(1)'),'连续内存可实现常数时间访问。',4),
(5,1,101,'single_choice','单链表反转的时间复杂度是？',JSON_ARRAY('O(1)','O(log n)','O(n)','O(n^2)'),JSON_OBJECT('index',2),'遍历一次链表即可完成反转，复杂度 O(n)。',5),
(6,1,102,'single_choice','以下哪个结构符合后进先出？',JSON_ARRAY('队列','栈','堆','哈希表'),JSON_OBJECT('index',1),'栈是 LIFO 结构。',1),
(7,1,102,'fill','用两个栈实现队列时，出队主要依赖 ____ 栈。',NULL,JSON_ARRAY('输出','out','out栈','输出栈'),'经典做法是输入栈 + 输出栈。',2),
(8,1,102,'single_choice','括号匹配问题常用哪种数据结构？',JSON_ARRAY('队列','栈','并查集','图'),JSON_OBJECT('index',1),'括号匹配天然符合栈的入栈/出栈模型。',3),
(9,1,102,'fill','循环队列判满条件常见写法是 (rear + 1) % n == ____。',NULL,JSON_ARRAY('front'),'预留一个空位时，rear 的下一位等于 front 表示满。',4),
(10,1,102,'single_choice','单调栈最典型应用是？',JSON_ARRAY('最短路','下一个更大元素','拓扑排序','并查集'),JSON_OBJECT('index',1),'单调栈经常用于求 next greater element。',5),
(11,1,103,'single_choice','二叉搜索树中序遍历结果是？',JSON_ARRAY('降序','升序','随机','层序'),JSON_OBJECT('index',1),'BST 中序遍历得到有序序列。',1),
(12,1,103,'fill','图的广度优先搜索通常使用 ____ 结构辅助实现。',NULL,JSON_ARRAY('队列'),'BFS 按层扩展节点，依赖队列。',2),
(13,1,103,'single_choice','平衡二叉树（AVL）的特点是？',JSON_ARRAY('任意节点度为2','左右子树高度差不超过1','只能存整数','一定是完全二叉树'),JSON_OBJECT('index',1),'AVL 保证任意节点左右子树高度差不超过 1。',3),
(14,1,103,'fill','最小生成树常见算法有 Prim 和 ____。',NULL,JSON_ARRAY('Kruskal','kruskal'),'MST 经典算法是 Prim 与 Kruskal。',4),
(15,1,103,'single_choice','有向无环图（DAG）可进行？',JSON_ARRAY('拓扑排序','最小割','欧拉回路','红黑树旋转'),JSON_OBJECT('index',0),'DAG 的典型操作是拓扑排序。',5),
(16,2,201,'single_choice','TCP 位于 OSI 模型的哪一层？',JSON_ARRAY('网络层','传输层','会话层','应用层'),JSON_OBJECT('index',1),'TCP 是传输层协议。',1),
(17,2,201,'fill','IP 协议提供的是 ____（可靠/不可靠）传输服务。',NULL,JSON_ARRAY('不可靠'),'IP 是无连接、不可靠的尽力而为服务。',2),
(18,2,201,'single_choice','以下哪个属于应用层协议？',JSON_ARRAY('IP','TCP','HTTP','ARP'),JSON_OBJECT('index',2),'HTTP 属于应用层。',3),
(19,2,201,'fill','ARP 协议用于通过 IP 地址解析 ____ 地址。',NULL,JSON_ARRAY('MAC','mac'),'ARP 实现 IP 到 MAC 的映射。',4),
(20,2,201,'single_choice','路由器主要工作在？',JSON_ARRAY('物理层','数据链路层','网络层','传输层'),JSON_OBJECT('index',2),'路由器根据网络层地址进行转发。',5),
(21,2,202,'single_choice','HTTP 默认端口是？',JSON_ARRAY('20','21','80','443'),JSON_OBJECT('index',2),'HTTP 默认端口是 80。',1),
(22,2,202,'fill','HTTPS = HTTP + ____。',NULL,JSON_ARRAY('TLS','SSL/TLS','tls'),'HTTPS 在 HTTP 之上增加 TLS。',2),
(23,2,202,'single_choice','HTTP 404 状态码表示？',JSON_ARRAY('服务器内部错误','资源未找到','请求成功','永久重定向'),JSON_OBJECT('index',1),'404 Not Found 表示资源不存在。',3),
(24,2,202,'fill','HTTP 请求方法中，通常用于创建资源的是 ____。',NULL,JSON_ARRAY('POST','post'),'REST 约定中 POST 常用于创建资源。',4),
(25,2,202,'single_choice','以下哪个响应头用于内容类型声明？',JSON_ARRAY('Content-Type','Cookie','ETag','Location'),JSON_OBJECT('index',0),'Content-Type 用于指明响应体媒体类型。',5),
(26,2,203,'single_choice','TCP 三次握手的目的是？',JSON_ARRAY('同步序列号并建立连接','加密通信','减少延迟','避免分片'),JSON_OBJECT('index',0),'三次握手用于双方确认收发能力并同步初始序列号。',1),
(27,2,203,'fill','TCP 四次挥手中，主动关闭方最后进入 ____ 状态等待。',NULL,JSON_ARRAY('TIME_WAIT','time_wait'),'主动关闭方会进入 TIME_WAIT。',2),
(28,2,203,'single_choice','下列哪项是 TLS 的作用？',JSON_ARRAY('路由寻址','应用加密与完整性保护','IP 地址分配','端口映射'),JSON_OBJECT('index',1),'TLS 提供加密、完整性校验和身份认证。',3),
(29,2,203,'fill','TCP 提供流量控制主要依赖接收窗口和 ____ 机制。',NULL,JSON_ARRAY('滑动窗口'),'滑动窗口机制用于控制发送速率。',4),
(30,2,203,'single_choice','DNS 的主要作用是？',JSON_ARRAY('域名解析','文件传输','邮件收发','网页渲染'),JSON_OBJECT('index',0),'DNS 负责将域名解析为 IP 地址。',5);
