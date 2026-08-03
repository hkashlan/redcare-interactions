# Product Interactions Coding Challenge

Please create your own github repository from this blueprint.

The challenge is aimed to take about 6 hours time to complete. Feel free to invest more time if you want to provide more insight, but documenting open points is totally fine. We'll follow it up with an interview where you can explain your perspectives.

You are free to leverage Ai as much as you'd like to complete the challenge.

## Context

Redcare exposes product interaction warnings in the shop frontend. One example
is the interaction widget at the bottom of:

https://www.shop-apotheke.com/wechselwirkungen/?productIds=04114918%2C10019621

In the real system, product data, ingredient data, and interaction texts come
from different data sources. For this challenge, we provide a small dockerized
mock service that represents a simplified part of that landscape.

The goal is to understand how you approach a realistic engineering task: making
sense of existing APIs, creating a useful integration layer, communicating
tradeoffs, and reviewing existing code.

## Provided Mock Service

This repository contains a small Java service with mock data. It exposes:

- `GET /product?productId={productId}`: returns product name and description.
- `GET /ingredients?productId={productId}`: returns ingredient ids for a
  product.
- `GET /interactions`: returns interaction data.

The OpenAPI contract is available in [openapi.yml](openapi.yml).

The mock data is intentionally small and resource-backed. Treat the service as
an external dependency of the service you will build, even if you run both
locally.

## Task: Build A Small API For The Frontend

Build a small service that exposes an interaction API for a frontend interaction
widget.

Your API should accept a list of product ids and return the information needed
to show interaction warnings for those products. You are free to choose the
exact response shape, but be ready to explain the tradeoffs.

You may use any technology you are comfortable with. If you prefer to stay close
to Redcare's stack, Java with Spring Boot or Kotlin are good choices.

Please include:

- Clear instructions for building and running your service locally.
- A short explanation of your API design.
- A short explanation of the important design choices you made.
- Any assumptions you made.
- A short note about anything you think is important for us to know.

You do not need to build a frontend. The shop URL above is only there to show
the kind of frontend experience your API would support.

## System Context

Assume the production version of this area is a distributed system:

- The frontend calls backend APIs to render product interaction warnings.
- The consumed data may come from separate services or data providers.
- Multiple instances of each service may run at the same time.
- Data can change independently of deployments.
- The system should be diagnosable during incidents.
- The service should be safe to operate in a regulated, customer-facing
  healthcare-adjacent domain.

This does not mean your solution must be enterprise-sized. It means your design
choices should acknowledge the environment the service would eventually live in.

## Follow-Up Discussion

After the coding part, we will use your solution as a starting point for a
broader engineering conversation.

We may talk about:

- How you approached the task.
- Why you shaped your API the way you did.
- Which tradeoffs you made.
- How you would continue from your current solution.
- What you noticed while reviewing the provided solution
- How you think about services that run as part of a larger system.

## What We Value

We are looking for engineers, not only coders. A strong solution does not need
to be large or fancy. It should show sound judgment.

Good signals include:

- A solution that is easy to run and understand.
- A response format that serves the frontend use case.
- Clear communication about decisions and assumptions.
- Thoughtful handling of edge cases.
- Review feedback that would help the team improve

## How To Submit

Please send us:

- A link to your repository or a zip file with your solution.
- Instructions for running it locally.
- Any short notes you want us to read before the interview.
