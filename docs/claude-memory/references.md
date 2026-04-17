# SAP Datasphere — Reference Documentation

This file collects the most useful official SAP documentation and community links for working with this project. Use these when writing new skills, understanding CLI behavior, or troubleshooting object creation.

---

## Datasphere Help Portal

**[SAP Datasphere Documentation — Landing Page](https://help.sap.com/docs/SAP_DATASPHERE?version=cloud&locale=en-US&state=PRODUCTION)**

The main entry point for all official Datasphere documentation. From here you can navigate to topics on:
- Space management
- Data modeling (tables, views, analytic models)
- Data integration and flows
- Security and authentication
- REST API reference

Start here when you need to understand a concept or find out what a specific object type supports.

---

## Datasphere CLI

**[CLI Command Reference (SAP Help Portal)](https://help.sap.com/docs/SAP_DATASPHERE/d0ecd6f297ac40249072a44df0549c1a/3f9a42ccde6b4b6aba121e2aab79c36d.html?locale=en-US)**

The primary reference for all CLI commands. Covers:
- Available commands for objects, spaces, flows, and more
- Required and optional parameters per command
- Input/output file formats (CSN JSON)
- Flags like `--no-deploy` and `--allow-missing-dependencies`

**Use this when:** writing a new skill, checking what parameters a command accepts, or understanding what a command returns.

**[CLI Overview — SAP Community Blog](https://community.sap.com/t5/technology-blogs-by-sap/sap-datasphere-cli-command-line-interface-for-sap-datasphere-overview/ba-p/13531596)**

A readable high-level overview of CLI capabilities and intended use cases. Good starting point for understanding the CLI's design and scope.

**[CLI Introduction Blog Post](https://community.sap.com/t5/technology-blogs-by-sap/new-command-line-interface-for-sap-datasphere-code-your-way-to-the-cloud/ba-p/13513481)**

In-depth explanation of CLI versioning (version numbers mirror the Datasphere release version) and the philosophy behind the tool.

---

## Authentication

**[OAuth Client for Interactive Usage (SAP Help Portal)](https://help.sap.com/docs/SAP_DATASPHERE/c8a54ee704e94e15926551293243fd1d/3f92b46fe0314e8ba60720e409c219fc.html)**

How to create an OAuth client in your Datasphere tenant. This is the recommended authentication method for this project — it produces the `CLIENT_ID` and `CLIENT_SECRET` values stored in `.env`.

**Use this when:** setting up the project for the first time or adding a new tenant.

**[Automated Passcode Retrieval — SAP Community Blog](https://community.sap.com/t5/technology-blogs-by-sap/automatically-add-members-to-spaces-in-sap-datasphere-using-sap-datasphere/ba-p/13512444)**

Describes programmatic passcode retrieval using a headless browser for fully unattended CLI automation (alternative to OAuth client credentials).

---

## Community & Support

**[SAP Datasphere Community Forum](https://pages.community.sap.com/topics/datasphere)**

SAP Community Q&A for Datasphere topics. Use the tag **`datasphere-cli`** when asking about CLI-specific issues. Useful for finding solutions to errors that aren't covered in the official docs.

For bugs in the CLI itself, open a support ticket in the [SAP Support Launchpad](https://launchpad.support.sap.com/#incident/create) using component **DS-API-CLI**. When reporting, attach a full trace log (`LOG_LEVEL=6`).
