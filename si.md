**全局事务如果要保证 A、B、C 要么都成功，要么都失败，这个“全局”归 Seata 管；Spring Integration 不负责跨服务的全局一致性**。
Spring Integration 负责的是**流程编排、消息分发、聚合、线程模型、错误流转**，它自己不是分布式事务协调器。([Home][1])

你可以先这样记：

* **SI 事务**：偏“流程内、本地、同线程/同资源”的事务边界
* **Seata 事务**：偏“跨服务、跨资源”的全局事务边界

---

## 一、先把两种“事务”彻底分开

### 1）Spring Integration 的事务是什么

Spring Integration 的事务，本质上还是 **Spring 本地事务能力** 在消息流里的使用。
它能保证的是：在某个消息流片段中，如果这些步骤运行在**同一个线程、同一个本地事务上下文、同一个事务资源**里，那么异常时可以一起回滚。Spring Integration 官方文档讲的也是“message flow”的事务支持，而不是分布式事务协调。([Home][1])

例如：

```text
收到一条消息
 -> 调用本地 service
 -> 写本地数据库
 -> 本地异常
 -> 本地事务回滚
```

这个叫 **SI 参与了事务边界管理**，但它不是全局事务协调者。

---

### 2）Seata 的事务是什么

Seata 的事务是 **全局事务**。
它有一个全局事务协调器概念，入口服务开启一个 global transaction，然后把各个下游服务纳入这个全局事务，最后统一决定 commit 或 rollback。Seata 官方 API 文档里 GlobalTransaction 就是 begin / commit / rollback 这一套。([Seata][2])

所以你例子里如果：

```text
主流程 -> A服务 insert
      -> B服务 insert
      -> C服务 insert
```

要做到：

```text
A成功
B成功
C失败
=> A、B 也撤销
```

这个能力不是 SI 自己给你的，而是 **Seata 的全局事务机制** 给你的。

---

## 二、放到你的例子里：到底谁负责什么

你现在是：

```text
Spring Integration
   -> publishSubscribe
       -> 调 A
       -> 调 B
       -> 调 C
```

假设：

* A insert 成功
* B insert 成功
* C insert 失败

这时分两种情况看。

---

### 情况 1：你只有 Spring Integration，没有 Seata

那 SI 只能做到：

* 把消息并发发给 A/B/C
* 收集返回结果
* 在 C 失败时抛异常 / 走 errorChannel / 聚合失败结果

但是 **A、B 已经成功写库的数据，SI 没法自动帮你跨服务回滚**。
因为 A/B/C 已经是独立服务、独立资源、独立数据库操作了，SI 不是分布式事务管理器。([Home][1])

也就是说：

```text
SI 能发现失败
SI 能停止后续流程
SI 能发补偿指令
但 SI 不能天然保证 A/B/C 跨服务原子提交
```

所以如果没有 Seata，你只能自己做：

* 补偿逻辑
* 状态机
* 最终一致性
* 人工/自动重试

---

### 情况 2：你用了 Seata

那就变成：

* **SI 负责流程编排**
* **Seata 负责全局事务一致性**

也就是：

```text
@GlobalTransactional
入口流程开始
   -> SI publishSubscribe 分发到 A/B/C
   -> A/B/C 都作为 Seata 全局事务参与者
   -> 如果 C 失败
   -> Seata 判定全局回滚
   -> A/B 执行回滚/补偿
```

所以你这个场景里，**“全局事务属于 Seata”**。
SI 只是承载这条业务链路，让 A/B/C 被调用起来。

---

## 三、为什么你会混淆：因为两者都会提“事务”

这是最容易混的点。

你看到 SI 也有 transaction，Seata 也有 transaction，于是会觉得是不是二选一。
实际上不是。

更准确地说：

* **Spring Integration 的事务**：是“消息流执行过程中的本地事务控制”
* **Seata 的事务**：是“跨多个服务/资源的一致性控制”

两者是上下层关系，不是同层竞争关系。

你可以把它理解成：

```text
SI = 编排层
Seata = 分布式事务协调层
MongoTransactionManager = 本地数据库事务层
```

---

## 四、A/B/C 成功失败时，真正的判定逻辑应该是什么

你这个场景最关键的不是“谁发消息”，而是“什么时候才算整个事务成功”。

正确思路是：

```text
1. 主流程开启 Seata 全局事务
2. SI publishSubscribe 分发给 A/B/C
3. A/B/C 都返回自己的 Try/执行结果
4. SI aggregate 聚合三个结果
5. 只有 A、B、C 全成功，主流程才结束并触发全局提交
6. 只要有一个失败，就抛异常，让 Seata 全局回滚
```

Spring Integration 的 aggregator 就是干这个“收齐结果再决策”的。官方文档里 aggregator 就是把多个消息聚合成一个消息；而 `apply-sequence=true` 会补齐 `sequenceSize` 等头，便于按同一组消息正确释放。([Home][3])

所以流程会更像这样：

```text
入口服务
  @GlobalTransactional
     -> publishSubscribe(A,B,C)
     -> aggregate
     -> if all success: return
     -> if any fail: throw exception
```

这里：

* `publishSubscribe` 是 SI 的能力
* `aggregate` 是 SI 的能力
* `throw exception -> global rollback` 是 Seata 的能力

---

## 五、但你这里还有一个更本质的问题：MongoDB

这一步非常关键。

如果 A/B/C 都是 MongoDB insert，那么你不能把它理解成“Seata 自动回滚 Mongo”。
因为 **Seata 的 AT/XA 模式不是给 MongoDB 用的**。你前面这个前提决定了，你这里的“回滚”只能靠：

* **TCC**
* 或 **Saga 补偿**

而不是关系库里那种 DataSource 代理式自动撤销。

也就是说：

```text
A 成功 insert
B 成功 insert
C 失败
```

Seata 不会神奇地帮你把 Mongo 的 insert 自动反向 delete，除非你自己实现了：

* A 的 Cancel
* B 的 Cancel
* C 的 Cancel

所以更准确地说：

> 在 Mongo 场景里，Seata 负责“统一决定要不要回滚”；
> 真正“怎么回滚 A/B 的数据”，要靠你自己的 TCC Cancel 或 Saga 补偿逻辑。

---

## 六、 SI publishSubscribe请求A、B 成功，C 失败，这个事务属于 SI 还是 Seata？

**属于 Seata 的全局事务。**
SI 不负责全局原子性，它负责把 A/B/C 调起来、收结果、在失败时把异常抛出来。
Seata 负责根据这个失败结果，驱动全局 rollback。
但在 MongoDB 场景下，这个 rollback 不是自动数据库回滚，而是你实现的补偿回滚。

---

## 七、你可以把职责画成这张图

```text
[入口服务]
  @GlobalTransactional   <-- Seata 全局事务开始
        |
        v
  Spring Integration Flow
        |
        +--> publishSubscribe
        |      +--> 调 A 服务（参与全局事务）
        |      +--> 调 B 服务（参与全局事务）
        |      +--> 调 C 服务（参与全局事务）
        |
        +--> aggregate A/B/C 执行结果
                |
                +--> 全成功：流程结束，Seata commit
                |
                +--> 任一失败：抛异常，Seata rollback
                                 |
                                 +--> A/B/C 执行 Cancel/补偿
```

---

## 八、再用“本地事务 / 全局事务”重新说一遍

### A 服务内部

A 服务里如果一次要写多个 Mongo 文档，那这是 **A 的本地事务**。
这时可以用 MongoTransactionManager 控制 A 服务内部的一致性。

### A + B + C 一起

A/B/C 三个服务一起要么都成功，要么都失败，这叫 **全局事务**。
这时是 Seata 管。

所以它们是：

```text
服务内一致性 -> 本地事务
服务间一致性 -> Seata 全局事务
```

---

## 九、publishSubscribe 下你要特别注意的一件事：并发线程不等于自动参与同一个全局事务

`PublishSubscribeChannel` 会把消息广播给多个订阅者；如果你给它配了 executor，还会并发执行。官方文档明确说明了它是广播语义。([Home][4])

这时一个大坑就是：

* Seata 的 XID 事务上下文默认和线程绑定
* publishSubscribe 一并发，线程切换了
* 子线程可能拿不到 XID
* 结果 A/B/C 表面上在一个流程里，实际没参与同一个全局事务

所以你的场景里，真正要做的是：

1. 主流程开启 `@GlobalTransactional`
2. 把 XID 放到 message header
3. publishSubscribe 子分支执行前重新 bind XID
4. WebClient 调下游时把 XID 放到请求头
5. 下游服务收到后再 bind XID

否则你会出现这种假象：

```text
看起来是一个流程
其实 A/B/C 各干各的
C 失败时 A/B 根本不会被纳入全局回滚
```

---

## 十、最推荐你采用的落地模式

针对你这个场景，我建议这么定义：

### 方案定位

* **SI**：做编排、分发、聚合、错误路由
* **Seata**：做全局事务协调
* **Mongo 本地事务**：做单服务内部一致性
* **TCC / Saga**：做 Mongo 的补偿回滚

### 执行模型

#### 主流程

```text
开启 Seata 全局事务
 -> SI publishSubscribe 调 A/B/C
 -> SI aggregate 等待 A/B/C 结果
 -> 任一失败，抛异常
 -> Seata 发起全局回滚
 -> 各服务执行 Cancel / 补偿
```

#### 各服务

```text
Try:
  插入 status=TRYING 的记录

Confirm:
  更新为 SUCCESS

Cancel:
  删除 TRYING 或改为 CANCELLED
```

这样你才真正能在 Mongo 场景里做到“接近原子”的全局一致性。

---

## 十一、你现在最该建立的判断标准

以后你只要问自己一句话就能分辨：

### 问题1：

“这次失败要不要把**别的服务**也一起撤销？”

* 要：这是 **Seata 全局事务**
* 不要：可能只是 **本地事务 / SI 流程异常处理**

### 问题2：

“这次事务是发生在**一个服务内部**，还是**跨多个服务**？”

* 一个服务内部：本地事务
* 多个服务之间：全局事务

### 问题3：

“SI 能不能自己让 A/B/C 跨服务自动回滚？”

* 不能
* SI 只能编排和承接异常
* 真正的一致性协调要靠 Seata 或你自己的补偿框架

---

## 十二、给你一个最简结论版

你这个例子：

```text
SI publishSubscribe -> A/B/C insert
A成功，B成功，C失败
```

正确理解是：

* **SI 负责把 A/B/C 调起来，并收集结果**
* **Seata 负责判定整个全局事务失败**
* **Mongo 下 A/B 的撤销靠 TCC/Saga 补偿，不是 SI 自动回滚，也不是 Seata AT 自动回滚**

所以这个事务从“全局一致性”角度看，**属于 Seata**。
从“流程编排执行”角度看，**运行在 SI 流里**。
两者不是二选一，而是配合关系。([Home][1])

下一步我可以直接给你画一版：

## 十二 SI + Seata + Mongo + publishSubscribe + aggregate” 的完整时序图



下面给你一张 **“SI + Seata + Mongo + publishSubscribe + aggregate” 完整时序图**。这张图按你最关心的场景来画：

* 入口服务用 **Spring Integration** 编排流程
* 用 **publishSubscribe** 并发调用 A / B / C
* 用 **aggregate** 等待三个分支结果
* 用 **Seata TCC** 做全局事务协调
* 每个服务内部如果有多文档写入，用 **Mongo 事务**
* Mongo 事务要求 **Replica Set / Sharded Cluster**，不能是普通 standalone；而 `publishSubscribe` 下如果后面接 `Aggregator`，要开启 `apply-sequence`，这样才会自动带上 `CORRELATION_ID / SEQUENCE_NUMBER / SEQUENCE_SIZE`。([MongoDB][1])

---

## 1）完整时序图

```mermaid
sequenceDiagram
    autonumber

    participant Client as Client / Caller
    participant TM as 入口服务(TM)
    participant SI as Spring Integration Flow
    participant PSC as PublishSubscribeChannel
    participant AGG as Aggregator
    participant TC as Seata TC
    participant A as Service A (RM/TCC)
    participant B as Service B (RM/TCC)
    participant C as Service C (RM/TCC)
    participant MA as Mongo A
    participant MB as Mongo B
    participant MC as Mongo C

    Client->>TM: 发起业务请求
    TM->>TC: begin global transaction
    TC-->>TM: 返回 XID

    TM->>SI: 进入 SI 主流程<br/>携带 XID / bizId
    SI->>PSC: publishSubscribe(apply-sequence=true)

    Note over PSC: 广播为 3 个分支消息<br/>自动补充 correlationId / sequenceNumber / sequenceSize

    par Branch A
        PSC->>A: WebClient 调用 A<br/>Header: XID,bizId,correlationId
        A->>A: bind XID
        A->>MA: Try阶段写入 Mongo<br/>status=TRYING
        MA-->>A: 本地成功
        A-->>SI: 返回 A=SUCCESS
    and Branch B
        PSC->>B: WebClient 调用 B<br/>Header: XID,bizId,correlationId
        B->>B: bind XID
        B->>MB: Try阶段写入 Mongo<br/>status=TRYING
        MB-->>B: 本地成功
        B-->>SI: 返回 B=SUCCESS
    and Branch C
        PSC->>C: WebClient 调用 C<br/>Header: XID,bizId,correlationId
        C->>C: bind XID
        C->>MC: Try阶段写入 Mongo<br/>status=TRYING
        MC-->>C: 本地失败 / 超时 / 异常
        C-->>SI: 返回 C=FAIL
    end

    SI->>AGG: 按 correlationId 聚合结果
    AGG-->>SI: 收到 A/B/C 三个分支结果

    alt 全部成功
        SI->>TM: 聚合成功
        TM->>TC: commit global transaction
        TC->>A: Confirm
        A->>MA: TRYING -> SUCCESS
        A-->>TC: Confirm OK

        TC->>B: Confirm
        B->>MB: TRYING -> SUCCESS
        B-->>TC: Confirm OK

        TC->>C: Confirm
        C->>MC: TRYING -> SUCCESS
        C-->>TC: Confirm OK

        TC-->>TM: Global Commit Success
        TM-->>Client: 返回成功
    else 任一失败
        SI->>TM: 聚合失败 / 抛异常
        TM->>TC: rollback global transaction

        TC->>A: Cancel
        A->>MA: TRYING -> CANCELLED / 删除预留数据
        A-->>TC: Cancel OK

        TC->>B: Cancel
        B->>MB: TRYING -> CANCELLED / 删除预留数据
        B-->>TC: Cancel OK

        TC->>C: Cancel
        C->>MC: 幂等取消 / 空回滚处理
        C-->>TC: Cancel OK

        TC-->>TM: Global Rollback Success
        TM-->>Client: 返回失败
    end
```

这张图里最核心的一点是：**publishSubscribe 和 aggregate 属于 SI；begin / commit / rollback 属于 Seata；Mongo 只负责各服务内部本地事务与数据持久化。** Spring Integration 自己不提供跨服务原子提交，它提供的是消息流事务支持与流程编排；Seata 的 `GlobalTransaction` 才负责全局 begin / commit / rollback。([Home][2])

---

## 2）把这张图拆开理解

### A. SI 在这里负责什么

SI 负责的是这几件事：

1. 接住入口请求，进入 integration flow
2. 用 `PublishSubscribeChannel` 并发发出 3 个分支
3. 用 `Aggregator` 按 `correlationId` 收齐 A/B/C 结果
4. 最终把“全成功”还是“有失败”这个结论返回给入口事务方法

`PublishSubscribeChannel` 下游如果要接 `Aggregator`，官方建议打开 `apply-sequence=true`，这样会自动带上 `CORRELATION_ID / SEQUENCE_NUMBER / SEQUENCE_SIZE`，Aggregator 才能知道“这一组消息一共该等几个”。([Home][3])

---

### B. Seata 在这里负责什么

Seata 负责的是：

1. 入口服务开启全局事务，拿到 XID
2. A/B/C 作为全局事务参与者加入同一个 XID
3. 如果 aggregate 判断有任一失败，入口方法抛异常
4. Seata TC 统一决定 `rollback`
5. 再通知各参与方执行 `Cancel`

Seata 官方文档里全局事务 API 明确就是 `begin / commit / rollback` 这一套；而 TCC 模式是服务层分布式事务方案，需要业务方实现 `Try / Confirm / Cancel`，并专门处理幂等、空回滚、悬挂等问题。([Seata][4])

---

### C. Mongo 在这里负责什么

Mongo 在这里不是 Seata AT 那种“自动反向回滚”的资源，而是：

* 每个服务内部的本地数据落库
* Try 阶段写入预留状态
* Confirm 阶段正式提交业务状态
* Cancel 阶段做补偿撤销

Mongo 官方文档说明，多文档事务支持在 replica set 和 sharded cluster 上提供；所以你如果要在服务内部使用 Mongo 本地事务，Mongo 环境必须满足这个前提。([MongoDB][1])

---

## 3）你这个场景里“失败点”是怎么流动的

针对你最关心的例子：

* A 成功
* B 成功
* C 失败

真正发生的是：

1. A/B/C 都先执行 **Try**
2. A/B 的 Try 成功，把数据写成 `TRYING`
3. C 的 Try 失败
4. SI 的 aggregate 收到 2 成功 + 1 失败
5. 聚合器把“失败”结论交回入口
6. 入口抛异常
7. Seata TC 发起全局 rollback
8. A/B 收到 Cancel，把 `TRYING` 改成 `CANCELLED` 或删除预留数据
9. C 收到 Cancel 时可能根本没写成功，这时要支持**空回滚**和**幂等取消**

这里你能看出来：
**SI 发现失败并汇总失败，Seata 决定全局回滚，业务服务执行补偿。** 这也是 Seata TCC 的标准职责划分。([Seata][5])

---

## 4）你实现时一定要补上的几个“隐藏节点”

### 4.1 XID 透传节点

时序图里虽然只写了 `Header: XID`，但这一步实际上非常关键。
因为 `publishSubscribe` 一旦配了 executor 并发执行，就会有线程切换；而 Seata 的事务上下文如果不被显式透传，子分支就可能拿不到同一个全局事务标识。Seata 的 TM/RM/TC 角色模型决定了客户端必须把上下文正确带到参与者侧。([Seata][6])

你可以把这一步理解成图中的隐含动作：

```text
主流程拿到 XID
 -> 放入 Message Header
 -> WebClient 请求头继续透传
 -> A/B/C 服务入口处 bind XID
```

---

### 4.2 aggregate 释放条件

Aggregator 一定要明确：

* 用哪个 header 做 correlation
* 什么时候 release
* 超时怎么办

因为官方说明里 `apply-sequence=true` 只是帮你设置序列头，不代表聚合逻辑自动就适合你的业务；你还需要根据 3 个分支结果决定 release 策略。([Home][7])

对于你这个场景，最直接的聚合规则就是：

```text
同一个 bizId / correlationId
等到 sequenceSize = 3
只要有一个 FAIL，就整体 FAIL
```

---

### 4.3 Cancel 的幂等、空回滚、悬挂

这是 Mongo + Seata TCC 必须重点防的。
Seata TCC 官方明确提到需要处理 idempotence、empty rollback、hanging。也就是说：

* Cancel 可能重复调用
* Cancel 可能先于 Try 可见
* Try 可能失败，但 Cancel 还是会来

所以你的 Mongo 记录里通常要保留这些字段：

```json
{
  "bizId": "xxx",
  "xid": "xxx",
  "status": "TRYING",
  "confirmDone": false,
  "cancelDone": false
}
```

这样 Confirm / Cancel 都可以做幂等判断。([Seata][5])

---

## 5）我再给你一张“职责归属图”

这张更适合你脑子里区分“到底谁的事务”。

```text
[Client]
   |
   v
[入口服务 @GlobalTransactional]  ---- 这是 Seata 全局事务入口
   |
   v
[Spring Integration Flow]       ---- 这是 SI 编排层，不是全局事务协调器
   |
   +--> publishSubscribe        ---- SI 并发分发
   |      +--> A 服务 Try       ---- Seata 参与者 + Mongo 本地事务
   |      +--> B 服务 Try       ---- Seata 参与者 + Mongo 本地事务
   |      +--> C 服务 Try       ---- Seata 参与者 + Mongo 本地事务
   |
   +--> aggregate               ---- SI 聚合判断
          |
          +--> all success --> Seata Commit --> Confirm A/B/C
          |
          +--> any fail    --> Seata Rollback --> Cancel A/B/C
```

所以你以后看到这个结构时，直接这样判断就行：

* **流程怎么走**：看 SI
* **全局成功还是失败谁说了算**：看 Seata
* **单个服务内部怎么落库/回滚**：看 Mongo 本地事务 + TCC 补偿

这和 Spring Integration 官方的事务支持定位、以及 Seata 的全局事务/TCC 模式定位是一致的。([Home][2])

---

## 6）你落地时建议直接按这个顺序实现

```text
1. Mongo 改成 replica set
2. 入口服务接入 Seata，开启 @GlobalTransactional
3. SI flow 里 publishSubscribe 开启 apply-sequence
4. 所有分支统一透传 xid / bizId / correlationId
5. A/B/C 实现 TCC：Try / Confirm / Cancel
6. aggregate 收齐 3 个结果后统一判定
7. 任一失败则抛异常，让 Seata rollback
8. Cancel 做幂等、空回滚、悬挂保护
```

这个顺序基本就是把官方要求和你的业务场景拼起来后的最稳妥方案。([MongoDB][8])

---
只考虑 Seata TCC 模式 的话，Seata Server 挂掉带来的问题，本质上可以概括成一句话：

Try 可能已经执行，但 Confirm / Cancel 没有人继续协调了，于是业务资源会卡在“已预留、未决议”的中间状态；恢复后依赖 TC 的重试机制继续推进，但如果你的 TCC 代码没有做好幂等、空回滚、悬挂防护，就很容易出现业务脏状态。 


---

1. 先明确：TCC 模式下 TC 挂掉，最怕的不是“数据库回滚失败”，而是“业务状态卡住”

TCC 不是 AT 那种依赖 undo log 自动回滚的模式。它要求你自己实现 Try / Confirm / Cancel 三个业务动作；全局事务提交时，TC 驱动各分支执行 Confirm，全局事务回滚时，TC 驱动各分支执行 Cancel。也就是说，TC 是否存活，直接决定第二阶段能不能继续往前推进。

所以在 TCC 场景里，一旦 Seata Server 挂掉，最典型现象不是“某条 SQL 立刻报错”，而是：

Try 已成功，资源已冻结

但 Confirm 迟迟没执行，资源长期占用
或

Try 已成功，本该 Cancel

但 Cancel 迟迟没执行，冻结状态不释放


这就是你在线上最容易看到的“订单处理中一直不结束、余额冻结不释放、库存预留长时间不归还”。


---

2. TC 挂掉时，TCC 具体会出现哪些问题

2.1 Try 成功后，Confirm 迟迟不来

这是最常见的。

例如：

账户 Try：冻结 100 元

库存 Try：冻结 1 件

订单 Try：写入处理中状态


这时如果全局事务本来应该提交，但 TC 挂了，那么 Confirm 不会按时下发。结果就是：

钱被冻结着

库存锁着

订单卡在处理中


从业务上看，这不一定立刻是“错账”，但一定是“中间态滞留”。TCC 模式本来就要求二阶段由 TC 协调执行，所以 TC 故障时，中间态延迟清理是最直接的问题。

2.2 Try 成功后，Cancel 迟迟不来

如果全局事务本来应该回滚，但 TC 挂了，那么 Cancel 无法及时触发。结果和上面类似：

冻结余额不释放

预扣库存不回补

预占资源长期不回收


这种情况比 Confirm 延迟更麻烦，因为它通常意味着业务已经失败，但资源还处于“假占用”状态，会继续影响后续请求。

2.3 第二阶段执行到一半，TC 挂了

比如 3 个分支里：

分支 A 已 Confirm

分支 B 还没 Confirm

分支 C 也没收到指令

然后 TC 挂了


这时你会遇到“部分分支二阶段已执行，部分还没执行”的状态。Seata 服务端提供了二阶段提交、异步提交、回滚、超时检测等恢复重试线程，TC 恢复后会继续尝试推进这些未完成事务。也就是说，系统设计上允许这种中间态存在，但要求你二阶段实现必须支持重试且幂等。


---

3. TCC 模式下，除了 TC 挂掉，还会把哪几类经典问题放大

Seata 官方对 TCC 一直强调三类异常问题：

幂等（idempotence）

空回滚（empty rollback）

悬挂 / dangling / suspension（不同文档有不同表述） 


TC 挂掉以后，这三类问题更容易暴露。

3.1 幂等问题

因为 TC 恢复后会重试二阶段，或者网络抖动时同一个 Confirm / Cancel 可能被多次投递，所以你的 Confirm 和 Cancel 不能执行一次成功、第二次就把数据弄坏。官方配置里存在专门的提交/回滚重试周期，也就是说重复调用本来就是系统正常恢复机制的一部分。

举例：

Cancel 第一次已经把冻结金额解掉了

TC 恢复后又重试了一次 Cancel

如果你没有幂等控制，就可能把余额再“多加回去一次”


这不是 Seata 的 bug，而是 TCC 业务实现必须自己扛住的。

3.2 空回滚问题

空回滚指的是：Cancel 先到了，但对应的 Try 实际上根本没成功执行，或者 Try 还没真正落地。官方明确说 TCC 实现要允许 empty rollback。

TC 故障恢复过程中，如果出现时序错乱、超时回滚、网络重发，这类情况会更常见。
如果你的 Cancel 逻辑默认认为“只要来了 Cancel，就一定存在 Try 记录”，很容易抛异常或做错业务处理。

3.3 悬挂问题

官方文档里讲得很明确：实现 TCC 时，要“允许空回滚，但在发生空回滚后，要拒绝之后的 Try”，否则会出现 hanging / suspense。

典型时序：

1. 因为超时或 TC 故障恢复，Cancel 先执行了


2. 之后迟到的 Try 又到达并成功执行


3. 结果资源又被冻住，但这个分支其实已经处于回滚后的世界了



这就是悬挂。
TC 挂掉、重试、网络乱序，会显著提高这种问题的出现概率。


---

4. TC 挂掉后，Seata 会不会自动恢复

会，但有前提。

Seata 服务端本身提供恢复与重试机制，包括：

server.recovery.committingRetryPeriod

server.recovery.asyncCommittingRetryPeriod

server.recovery.rollbackRetryPeriod

server.recovery.timeoutRetryPeriod 


这意味着：
TC 重启恢复后，会继续扫描并重试那些处于提交中、回滚中、超时中的全局事务。

但这只是“协调层会继续努力推进”，并不等于你的业务一定天然安全。最终能不能正确恢复，依赖两点：

1. 事务状态有没有可靠持久化


2. 你的 Confirm / Cancel 是否真正幂等、是否处理了空回滚和悬挂 




---

5. 只看 TCC，TC 挂掉后你应该怎么处理

下面说实战处理。

5.1 第一原则：Try 必须是“冻结资源”，不是“直接最终扣减”

这是 TCC 能抗故障的前提。

正确做法通常是：

账户：可用余额减，冻结余额加

库存：可售库存减，冻结库存加

优惠券：状态改为预占用

订单：状态设为 PROCESSING / PENDING


不要在 Try 里直接做最终扣减，否则 TC 一挂、Cancel 又没及时到，你就很难恢复。TCC 的基本设计就是通过预留资源来等待二阶段决议。

5.2 第二原则：Confirm / Cancel 必须天然幂等

你要接受一个事实：
Confirm 和 Cancel 不是“可能重复”，而是“默认就会重复”。

处理方式一般是给每个分支事务保存一条事务控制记录，至少包含：

xid

branchId

actionName 或业务类型

状态（TRYING / CONFIRMED / CANCELED）

是否有 try 成功标记


收到 Confirm / Cancel 时先查这张控制表：

已 Confirm 过：直接返回成功

已 Cancel 过：直接返回成功

没执行过：再进入业务处理


Seata 官方针对 TCC fence 的设计核心也是围绕这些问题展开，目的就是帮助解决幂等、悬挂、空回滚。

5.3 第三原则：Cancel 必须允许空回滚

也就是：

如果没找到 Try 成功记录

不要直接报错把事务卡死

应该把这次 Cancel 记下来，并视为“空回滚已处理”


官方明确建议 TCC 服务实现要允许 empty rollback。

这一步非常关键，因为 TC 恢复重试时，你根本不能假设调用顺序永远完美。

5.4 第四原则：Try 必须防悬挂

如果系统曾经已经执行过空回滚，后面迟到的 Try 必须拒绝。

也就是说在 Try 执行前先检查事务控制表：

如果发现这个 xid + branchId 已经标记为 CANCELED

直接拒绝 Try


这是 Seata 官方文档里对 hanging / suspense 的核心处理思路。

5.5 第五原则：启用并理解 TCC Fence

Seata 从较新的版本开始，重点增强了 TCC Fence，用来统一处理：

幂等

空回滚

悬挂


官方相关文章明确说明，1.5.1 及之后围绕这些问题做了增强。

所以如果你做的是生产级 TCC，不建议自己零散地手搓所有边界逻辑，而是优先研究并使用官方推荐的 fence 机制，把分支控制状态落库管理起来。


---

6. 从运维角度，TC 挂掉后怎么降低影响

6.1 不要把 TC 当单点临时服务

如果是生产环境，不要用脆弱的单机临时部署方式。Seata 官方对存储与高可用有明确讨论，TC 重启后能否恢复、能否继续重试，依赖其事务状态存储与恢复能力。

6.2 调整恢复重试参数

至少要关注这些服务端参数：

server.recovery.committingRetryPeriod

server.recovery.rollbackRetryPeriod

server.recovery.timeoutRetryPeriod

server.maxCommitRetryTimeout

server.maxRollbackRetryTimeout 


含义很直接：

多久扫一次未完成事务

最长重试多久

超时事务多久转入回滚流程


如果这些参数太激进，故障时会频繁重试；太保守，则业务中间态会拖很久。

6.3 做业务侧巡检和补偿

即使有 TC 重试，也不能完全只靠 Seata。对 TCC 业务建议补一层巡检：

找出长时间处于“冻结中/处理中”的业务单

根据事务控制表判断是否缺 Confirm / Cancel

做人工补偿或自动补偿


因为 TCC 是业务补偿型事务，不是数据库级全自动一致性。


---

7. 给你一个最实战的故障处理方案

如果我是按生产方案设计 TCC，我会这么做：

Try 阶段

只做资源冻结

写本地事务控制记录：TRYING

记录 xid、branchId、业务主键

如果已存在 CANCELED 记录，拒绝 Try，防悬挂 


Confirm 阶段

先查控制记录

如果已 CONFIRMED，直接成功返回

如果已 CANCELED，拒绝重复提交并报警

否则执行业务确认，把 TRYING -> CONFIRMED 


Cancel 阶段

若无 Try 记录，按空回滚处理，插入 CANCELED

若已 CANCELED，直接返回成功

若是 TRYING，执行业务释放，把 TRYING -> CANCELED 


运维层

保证 TC 状态可恢复

开启重试监控

建立“冻结资源超时告警”

定期扫描异常中间态单据 



---

8. 最后给你一个结论版

只考虑 TCC 模式时，Seata Server 挂掉后的核心问题不是“SQL 回滚失败”，而是：

1. Try 已成功，Confirm / Cancel 无法及时执行，资源长时间冻结。


2. TC 恢复后会重试二阶段，所以 Confirm / Cancel 必须幂等。


3. 故障恢复和乱序下，空回滚与悬挂问题会更明显，Cancel 要允许空回滚，Try 要防悬挂。


4. 最推荐的处理方式是：冻结式 Try + 事务控制表 + 幂等状态机 + TCC Fence + 运维巡检补偿。
