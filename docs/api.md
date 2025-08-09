# WebPods API

WebPods is an append-only log service with OAuth authentication.

## Authentication

Use Google OAuth to authenticate:
```
GET /auth/google
```

After authentication, you'll receive a JWT token to use in subsequent requests:
```
Authorization: Bearer {jwt_token}
```

## Queue Operations

### Write to Queue
```http
POST /q/{queue_id}
Authorization: Bearer {token}
Content-Type: application/json

{"message": "Hello, World!"}
```

Options:
- `?read=public|auth|owner` - Set read permission (default: owner)
- `?write=auth|owner` - Set write permission (default: owner)

### Read from Queue
```http
GET /q/{queue_id}?limit=100&after=50
Authorization: Bearer {token}  # Optional for public queues
```

Returns:
```json
{
  "queue": {"q_id": "my-queue", "created_at": "..."},
  "records": [
    {
      "id": 51,
      "sequence_num": 51,
      "content": {"message": "Hello"},
      "created_at": "..."
    }
  ],
  "has_more": true,
  "total": 150
}
```

### Get Single Record
```http
GET /q/{queue_id}/{index}
```

### Delete Queue
```http
DELETE /q/{queue_id}
Authorization: Bearer {token}
```

## Permissions

- `public` - Anyone can access
- `auth` - Any authenticated user can access  
- `owner` - Only the queue creator can access

## Rate Limits

- Write: 2000/hour per user
- Read: 10000/hour per user

Rate limit info in response headers:
```
X-RateLimit-Limit: 2000
X-RateLimit-Remaining: 1999
X-RateLimit-Reset: 1704070800
```

## Error Responses

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this queue"
  }
}
```

Common codes:
- `INVALID_INPUT` - Bad request parameters
- `UNAUTHORIZED` - Missing/invalid token
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Queue/record not found
- `RATE_LIMIT_EXCEEDED` - Too many requests