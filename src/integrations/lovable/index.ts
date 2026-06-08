// Lovable broker replaced with direct Supabase OAuth
export const lovable = {
  auth: {
    signInWithOAuth: async () => {
      throw new Error("Use supabase.auth.signInWithOAuth directly");
    },
  },
};
