# WebPods Architecture

## Table of Contents
- [Overview](#overview)
- [Core Principles](#core-principles)
- [System Components](#system-components)
- [Data Model](#data-model)
- [Request Flow](#request-flow)
- [Security Architecture](#security-architecture)
- [Scalability Considerations](#scalability-considerations)
- [Technology Stack](#technology-stack)

## Overview

WebPods is designed as a simple, scalable append-only log service with OAuth authentication. The architecture prioritizes simplicity, reliability, and ease of deployment while maintaining the flexibility to scale horizontally.

## Core Principles

### 1. Append-Only Design
- **Immutability**: Once written, records cannot be modified or individually deleted
- **Sequential Ordering**: Each record has a monotonically increasing sequence number
- **Audit Trail**: Complete history preservation for compliance and debugging
- **Simplicity**: No complex conflict resolution or merge strategies needed

### 2. Queue-Based Organization
- **Named Queues**: User-defined identifiers for logical data separation
- **Auto-Creation**: Queues created on first write, reducing API complexity
- **Independent Scaling**: Queues can be partitioned and scaled independently
- **Multi-Tenancy**: Natural isolation between different users' data

### 3. RESTful API Design
- **Standard HTTP Verbs**: POST for writes, GET for reads, DELETE for queue removal
- **Stateless**: Each request contains all necessary information
- **Resource-Oriented**: URLs represent resources (queues, records)
- **Content Negotiation**: Support for both JSON and plain text

### 4. OAuth-First Authentication
- **Industry Standard**: OAuth 2.0 with JWT tokens
- **Provider Flexibility**: Starting with Google, extensible to other providers
- **Stateless Authentication**: JWT tokens eliminate session storage needs
- **Fine-Grained Permissions**: Per-queue read/write permissions

## System Components

```
┌─────────────────────────────────────────────────────────┐
│                      Client Applications                 │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────────────┐
│                    Load Balancer                         │
│                   (nginx/HAProxy)                        │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                  WebPods API Servers                     │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Express.js Application               │   │
│  │  ┌──────────────────────────────────────────┐    │   │
│  │  │          Authentication Layer            │    │   │
│  │  │         (Passport.js + JWT)             │    │   │
│  │  └──────────────────────────────────────────┘    │   │
│  │  ┌──────────────────────────────────────────┐    │   │
│  │  │           Rate Limiting                  │    │   │
│  │  │        (PostgreSQL-backed)              │    │   │
│  │  └──────────────────────────────────────────┘    │   │
│  │  ┌──────────────────────────────────────────┐    │   │
│  │  │         Business Logic Layer             │    │   │
│  │  │    (Queue, Permission, Record Mgmt)     │    │   │
│  │  └──────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                    PostgreSQL Database                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Tables: user, queue, record, rate_limit         │   │
│  │ Indexes: Optimized for append and range queries  │   │
│  │ Constraints: Foreign keys, unique constraints    │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### API Server
- **Framework**: Express.js for HTTP handling
- **Validation**: Zod for request/response validation
- **Authentication**: Passport.js with Google OAuth strategy
- **Database**: Knex.js query builder for PostgreSQL
- **Logging**: Structured logging with context

### Database Layer
- **PostgreSQL**: Primary data store for all application data
- **No Caching Layer**: Simplicity over premature optimization
- **Connection Pooling**: Managed by Knex.js
- **Transactional Consistency**: ACID compliance for data integrity

### Authentication Service
- **OAuth Provider**: Google OAuth 2.0 (extensible to others)
- **JWT Tokens**: Stateless authentication tokens
- **Token Validation**: Middleware-based validation
- **User Management**: Automatic user creation on first login

## Data Model

### Entity Relationships

```
┌──────────────┐
│     user     │
│──────────────│
│ id (UUID)    │◄──────┐
│ auth_id      │       │
│ email        │       │
│ name         │       │
│ provider     │       │
└──────────────┘       │
                       │ creator_id
┌──────────────┐       │
│    queue     │───────┘
│──────────────│
│ id (UUID)    │◄──────┐
│ q_id         │       │
│ creator_id   │       │
│ read_perm    │       │
│ write_perm   │       │
└──────────────┘       │
                       │ queue_id
┌──────────────┐       │
│    record    │───────┘
│──────────────│
│ id           │
│ queue_id     │
│ sequence_num │
│ content      │
│ content_type │
│ metadata     │
│ created_by   │
└──────────────┘

┌──────────────┐
│  rate_limit  │
│──────────────│
│ id           │
│ user_id      │───────► user.id
│ action       │
│ count        │
│ window_start │
└──────────────┘
```

### Key Design Decisions

1. **UUIDs for User/Queue IDs**: Globally unique, no central coordination needed
2. **Sequential IDs for Records**: Efficient append operations, natural ordering
3. **JSONB for Content/Metadata**: Flexible schema, queryable in PostgreSQL
4. **Denormalized Permissions**: Stored directly on queue for fast access
5. **Sliding Window Rate Limiting**: Accurate rate limiting without fixed windows

## Request Flow

### Write Operation

```
1. Client Request
   └─> Authentication Middleware
       └─> JWT Validation
           └─> Rate Limit Check
               └─> Permission Check
                   └─> Queue Creation/Update (if needed)
                       └─> Record Insertion
                           └─> Response
```

### Read Operation

```
1. Client Request
   └─> Optional Authentication
       └─> Rate Limit Check (if authenticated)
           └─> Queue Lookup
               └─> Permission Check
                   └─> Record Retrieval
                       └─> Response Formatting
                           └─> Response
```

## Security Architecture

### Authentication & Authorization
- **OAuth 2.0**: Industry-standard authentication
- **JWT Tokens**: Cryptographically signed, time-limited tokens
- **Permission Model**: Three-tier (public, auth, owner)
- **CORS**: Configurable cross-origin resource sharing

### Data Protection
- **HTTPS Only**: TLS encryption for all API traffic
- **SQL Injection Prevention**: Parameterized queries via Knex.js
- **Input Validation**: Zod schemas for all inputs
- **XSS Prevention**: Content-type aware responses

### Rate Limiting
- **Per-User Limits**: Prevent individual user abuse
- **Action-Based**: Different limits for read/write
- **Database-Backed**: Survives server restarts
- **Sliding Window**: Accurate rate calculation

### Operational Security
- **Environment Variables**: Sensitive configuration outside code
- **No Secrets in Logs**: Careful logging practices
- **Health Checks**: Separate endpoint without sensitive data
- **Audit Trail**: All writes tracked with user ID

## Scalability Considerations

### Horizontal Scaling
```
┌──────────┐ ┌──────────┐ ┌──────────┐
│  API-1   │ │  API-2   │ │  API-3   │
└────┬─────┘ └────┬─────┘ └────┬─────┘
     └────────────┼────────────┘
                  │
           ┌──────▼──────┐
           │ PostgreSQL  │
           │  (Primary)  │
           └──────┬──────┘
                  │
     ┌────────────┼────────────┐
┌────▼────┐ ┌────▼────┐ ┌────▼────┐
│ Read-1  │ │ Read-2  │ │ Read-3  │
└─────────┘ └─────────┘ └─────────┘
```

### Performance Optimizations
1. **Connection Pooling**: Reuse database connections
2. **Index Strategy**: Optimized for append and range queries
3. **Pagination**: Limit-based pagination for large queues
4. **Stateless Design**: Any server can handle any request

### Future Scaling Options
1. **Read Replicas**: Offload read traffic from primary
2. **Queue Partitioning**: Distribute queues across databases
3. **Caching Layer**: Add Redis for hot data (if needed)
4. **CDN**: Cache public queue responses at edge

## Technology Stack

### Backend
- **Runtime**: Node.js 22+ (LTS)
- **Framework**: Express.js 4.x
- **Language**: TypeScript 5.x
- **Database**: PostgreSQL 16+
- **ORM/Query Builder**: Knex.js

### Libraries
- **Authentication**: Passport.js, jsonwebtoken
- **Validation**: Zod
- **HTTP Security**: Helmet, CORS
- **Logging**: Debug
- **Testing**: Mocha, Chai
- **HTTP Client**: Axios (for tests)

### Infrastructure
- **Container**: Docker with multi-stage builds
- **Process Manager**: Node.js cluster (production)
- **Database Migrations**: Knex migrations
- **Development**: Docker Compose with hot reload

### Deployment
- **Platforms**: Docker, Kubernetes, Traditional VPS
- **Load Balancer**: nginx, HAProxy, or cloud LB
- **Monitoring**: Prometheus metrics endpoint (planned)
- **Logging**: Structured JSON logs

## Design Trade-offs

### Simplicity vs Features
- **Choice**: Single PostgreSQL database
- **Trade-off**: Simpler operations vs potential scaling limits
- **Rationale**: Most applications won't hit PostgreSQL limits

### Flexibility vs Performance
- **Choice**: JSONB for content storage
- **Trade-off**: Flexible schema vs slightly slower than native types
- **Rationale**: Developer experience and adaptability prioritized

### Security vs Convenience
- **Choice**: OAuth-only authentication
- **Trade-off**: No username/password vs OAuth provider dependency
- **Rationale**: Industry-standard security without password management

### Consistency vs Availability
- **Choice**: Single primary database
- **Trade-off**: Strong consistency vs high availability
- **Rationale**: Data correctness prioritized for audit trail use cases